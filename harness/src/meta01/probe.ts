import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, loadConfig, type HarnessConfig } from "../config.ts";
import type { DefaultSnapshot } from "./grader.ts";
import { pristineArchitectureFault } from "./grader.ts";
import { assessAuthorityIntegrity, readAuthorityBehavior } from "./authority.ts";
import { decideMeta01 } from "./decision.ts";
import { integrityFromPatch } from "./integrity.ts";
import { runMaintenanceAgent } from "./maintenance-agent.ts";
import { measureMaintenanceDiff, type TrialMetric } from "./metrics.ts";
import { collectWorktreePatch } from "./patch.ts";
import { META01_PARENT_REVISION, META01_TRIALS_PER_ARM } from "./policy.ts";
import { runMetaImprover } from "./improver.ts";
import {
  emptyRecord,
  writeCandidateRecord,
  type CandidateRecord,
} from "./record.ts";
import { regressionPassed, runRevisionRegression } from "./regression.ts";
import { materializeCandidateRevision, provenanceMatches } from "./revision.ts";
import { createCandidateSession, hypothesisAcceptedBeforeFirstWrite } from "./session.ts";
import { createExactWorkspace, removeWorkspace } from "./worktree.ts";
import { git } from "./git.ts";

const harnessDir = path.dirname(fileURLToPath(import.meta.url));

export async function evaluateAdmitted<T>(
  admitted: boolean,
  evaluate: () => Promise<T>,
): Promise<T | null> {
  if (!admitted) {
    return null;
  }
  return evaluate();
}

export async function runMeta01Experiment(): Promise<CandidateRecord> {
  const config = loadConfig();
  const candidateId = `meta01-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const record = emptyRecord({ candidateId, configuredModel: config.model });
  let patchText: string | null = null;
  const workspace = createExactWorkspace({
    id: candidateId,
    ref: META01_PARENT_REVISION,
  });
  try {
    const session = createCandidateSession({
      workspaceRoot: workspace.root,
      parentRevision: workspace.baseRevision,
    });
    console.log(`META01 improver workspace ${workspace.root} @ ${workspace.baseRevision}`);
    await runMetaImprover({
      config,
      session,
      runTests: async () => {
        const results = await runRevisionRegression({
          workspaceRoot: workspace.root,
          config,
          tasks: ["npm-test"],
        });
        return results[0]?.outputTail ?? "npm test produced no output";
      },
    });
    record.hypothesis = session.hypothesis;
    const patch = collectWorktreePatch(workspace.root);
    record.changedFiles = patch.files;
    record.patchStats = {
      files: patch.files,
      additions: patch.additions,
      deletions: patch.deletions,
      perFile: patch.perFile,
      newModules: patch.newModules,
      newFeatureBranches: patch.newFeatureBranches,
    };
    const head = git(workspace.root, ["rev-parse", "HEAD"]).trim();
    let behavior = readAuthorityBehavior(null);
    try {
      behavior = readAuthorityBehavior(runGradeChild(workspace.root, "authority"));
    } catch {
      behavior = readAuthorityBehavior(null);
    }
    const authorityIntegrity = assessAuthorityIntegrity({
      addedLines: patch.addedLines,
      removedLines: patch.removedLines,
      behavior,
    });
    record.authorityIntegrity = authorityIntegrity;
    const integrity = integrityFromPatch({
      baseRevision: head,
      patch,
      hypothesisAcceptedBeforeFirstWrite: hypothesisAcceptedBeforeFirstWrite(session),
      authorityIntegrity,
    });
    record.integrityChecks = integrity.checks;
    if (!integrity.passed) {
      patchText = git(workspace.root, ["diff", "HEAD"]);
      return finish(record, "candidate_rejected", ["candidate integrity gate failed"], patchText);
    }
    let revision;
    try {
      revision = materializeCandidateRevision({
        hostRepoRoot: REPO_ROOT,
        workspaceRoot: workspace.root,
        candidateId,
      });
    } catch (error) {
      return finish(
        record,
        "candidate_rejected",
        [`failed to materialize candidateRevision: ${error instanceof Error ? error.message : String(error)}`],
        patchText,
      );
    }
    record.candidateRevision = revision.candidateRevision;
    record.candidateRef = revision.ref;
    record.patchHash = revision.patchHash;
    record.mainUnchanged = revision.mainUnchanged;
    patchText = revision.patch;
    if (!revision.mainUnchanged) {
      return finish(record, "candidate_rejected", ["materializing the candidate moved the current branch"], patchText);
    }
    const proved = provenanceMatches({
      parentRevision: revision.parentRevision,
      candidateRevision: revision.candidateRevision,
      patchHash: revision.patchHash,
      hostRepoRoot: REPO_ROOT,
    });
    if (!proved.ok) {
      return finish(record, "candidate_rejected", [proved.reason], patchText);
    }

    const compared = await evaluateAdmitted(true, () =>
      compareRevisions({
        config,
        parentRevision: META01_PARENT_REVISION,
        candidateRevision: revision.candidateRevision,
        record,
      }),
    );
    if (!compared) {
      return finish(record, "candidate_rejected", ["admission did not reach evaluation"], patchText);
    }
    return finish(record, compared.decision, compared.reasons, patchText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (record.regressionEvidence.h0.length === 0) {
      return finish(record, "candidate_rejected", [`META01 aborted before H0 regression: ${message}`], patchText);
    }
    return finish(
      record,
      "experiment_stopped_insufficient_regression_evidence",
      [message],
      patchText,
    );
  } finally {
    removeWorkspace(workspace);
  }
}

async function compareRevisions(options: {
  config: HarnessConfig;
  parentRevision: string;
  candidateRevision: string;
  record: CandidateRecord;
}): Promise<{ decision: CandidateRecord["decision"]; reasons: string[] }> {
  options.record.regressionEvidence.h0 = await runCleanRegression(
    options.parentRevision,
    options.config,
    "h0",
  );
  if (!regressionPassed(options.record.regressionEvidence.h0)) {
    return {
      decision: "experiment_stopped_insufficient_regression_evidence",
      reasons: [
        "H0 did not confirm the frozen regression contracts in this environment. H1 was not scored.",
      ],
    };
  }
  options.record.regressionEvidence.h1 = await runCleanRegression(
    options.candidateRevision,
    options.config,
    "h1",
  );
  if (!regressionPassed(options.record.regressionEvidence.h1)) {
    return {
      decision: "candidate_rejected",
      reasons: ["H1 failed the existing regression gate"],
    };
  }

  const pristineH0 = capturePristine(options.parentRevision);
  options.record.pristineH0 = pristineH0.snapshot;
  if (pristineArchitectureFault(pristineH0.snapshot)) {
    return {
      decision: "experiment_stopped_insufficient_regression_evidence",
      reasons: [
        "H0 default loop did not complete the pristine grader episode. H1 maintenance was not scored.",
      ],
    };
  }
  const pristineH1 = capturePristine(options.candidateRevision);
  options.record.pristineH1 = pristineH1.snapshot;
  if (pristineArchitectureFault(pristineH1.snapshot)) {
    return {
      decision: "candidate_rejected",
      reasons: ["pristine admitted H1 failed the default-path architecture check"],
    };
  }

  const h0Trials = await runMaintenanceArm({
    config: options.config,
    revision: options.parentRevision,
    snapshot: pristineH0.snapshot,
    label: "h0",
  });
  const h1Trials = await runMaintenanceArm({
    config: options.config,
    revision: options.candidateRevision,
    snapshot: pristineH1.snapshot,
    label: "h1",
  });
  options.record.maintenanceBaselineEvidence = h0Trials.trials;
  options.record.maintenanceCandidateEvidence = h1Trials.trials;
  const basesMatch =
    h0Trials.baseRevisions.every((revision) => revision === options.parentRevision) &&
    h1Trials.baseRevisions.every((revision) => revision === options.candidateRevision);
  const proved = provenanceMatches({
    parentRevision: options.parentRevision,
    candidateRevision: options.candidateRevision,
    patchHash: options.record.patchHash ?? "",
    hostRepoRoot: REPO_ROOT,
  });
  const decision = decideMeta01({
    integrityPassed: true,
    h0RegressionConfirmed: true,
    h1RegressionPassed: true,
    insufficientRegressionEvidence: false,
    authorityExpanded: false,
    forbiddenFilesMutated: false,
    pristineArchitectureFault: false,
    provenance: proved.ok && basesMatch && options.record.mainUnchanged === true ? "valid" : "invalid",
    h0: h0Trials.trials,
    h1: h1Trials.trials,
  });
  return decision;
}

async function runCleanRegression(
  revision: string,
  config: HarnessConfig,
  label: string,
) {
  const workspace = createExactWorkspace({
    id: `meta01-reg-${label}-${Date.now()}`,
    ref: revision,
  });
  try {
    return await runRevisionRegression({ workspaceRoot: workspace.root, config });
  } finally {
    removeWorkspace(workspace);
  }
}

function capturePristine(revision: string): { snapshot: DefaultSnapshot } {
  const workspace = createExactWorkspace({
    id: `meta01-pristine-${Date.now()}`,
    ref: revision,
  });
  try {
    return { snapshot: runGradeChild(workspace.root, "baseline") as DefaultSnapshot };
  } finally {
    removeWorkspace(workspace);
  }
}

async function runMaintenanceArm(options: {
  config: HarnessConfig;
  revision: string;
  snapshot: DefaultSnapshot;
  label: string;
}): Promise<{ trials: TrialMetric[]; baseRevisions: string[] }> {
  const trials: TrialMetric[] = [];
  const baseRevisions: string[] = [];
  for (let index = 0; index < META01_TRIALS_PER_ARM; index += 1) {
    const workspace = createExactWorkspace({
      id: `meta01-${options.label}-${index + 1}-${Date.now()}`,
      ref: options.revision,
    });
    try {
      console.log(`META01 maintenance ${options.label} trial ${index + 1} @ ${workspace.baseRevision}`);
      baseRevisions.push(workspace.baseRevision);
      const agent = await runMaintenanceAgent({
        config: options.config,
        workspaceRoot: workspace.root,
      });
      const baselineFile = path.join(
        os.tmpdir(),
        `meta01-baseline-${options.label}-${index}-${Date.now()}.json`,
      );
      fs.writeFileSync(baselineFile, JSON.stringify(options.snapshot));
      const grade = runGradeChild(workspace.root, "grade", baselineFile) as {
        passed?: boolean;
      };
      const diff = measureMaintenanceDiff(workspace.root);
      trials.push({
        ...diff,
        externalGraderPassed: grade.passed === true,
        modelCalls: agent.modelCalls,
        toolCalls: agent.toolCalls,
        wallTimeMs: agent.wallTimeMs,
      });
    } finally {
      removeWorkspace(workspace);
    }
  }
  return { trials, baseRevisions };
}

function runGradeChild(
  workspaceRoot: string,
  mode: "baseline" | "grade" | "authority",
  baselinePath?: string,
): unknown {
  const tsx = path.join(REPO_ROOT, "harness", "node_modules", ".bin", "tsx");
  const child = path.join(harnessDir, "grade-child.ts");
  const args = [child, "--workspace", workspaceRoot, "--mode", mode];
  if (baselinePath) {
    args.push("--baseline", baselinePath);
  }
  const result = spawnSync(tsx, args, {
    cwd: path.join(REPO_ROOT, "harness"),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const line = `${result.stdout ?? ""}`
    .split("\n")
    .reverse()
    .find((item) => item.startsWith("META01_JSON "));
  if (!line) {
    throw new Error(
      `grade child produced no result: ${result.stderr || result.stdout || result.error?.message}`,
    );
  }
  return JSON.parse(line.slice("META01_JSON ".length)) as unknown;
}

function finish(
  record: CandidateRecord,
  decision: CandidateRecord["decision"],
  reasons: string[],
  patch: string | null,
): CandidateRecord {
  record.decision = decision;
  record.decisionReasons = reasons;
  const written = writeCandidateRecord({ record, patch });
  console.log(`META01 decision: ${decision}`);
  console.log(`META01 record: ${written.jsonPath}`);
  return record;
}
