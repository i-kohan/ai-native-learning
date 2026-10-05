import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.ts";
import type { AuthorityIntegrity } from "./authority.ts";
import type { ImprovementHypothesis } from "./hypothesis.ts";
import type { IntegrityCheck } from "./integrity.ts";
import type { TrialMetric } from "./metrics.ts";
import type { PatchStats } from "./patch.ts";
import type { Meta01Decision } from "./policy.ts";
import { META01_EXPERIMENT_ID, META01_PARENT_REVISION } from "./policy.ts";
import type { RegressionCommandResult } from "./regression.ts";
import type { DefaultSnapshot } from "./grader.ts";

export type CandidateRecord = {
  experimentId: typeof META01_EXPERIMENT_ID;
  parentRevision: string;
  candidateRevision: string | null;
  candidateRef: string | null;
  candidateId: string;
  configuredModel: string;
  hypothesis: ImprovementHypothesis | null;
  allowedMutationFiles: string[];
  changedFiles: string[];
  patchHash: string | null;
  patchStats: PatchStats | null;
  integrityChecks: IntegrityCheck[];
  authorityIntegrity: AuthorityIntegrity | null;
  regressionEvidence: {
    h0: RegressionCommandResult[];
    h1: RegressionCommandResult[];
  };
  maintenanceBaselineEvidence: TrialMetric[];
  maintenanceCandidateEvidence: TrialMetric[];
  pristineH0: DefaultSnapshot | null;
  pristineH1: DefaultSnapshot | null;
  decision: Meta01Decision;
  decisionReasons: string[];
  mainUnchanged: boolean | null;
};

export function writeCandidateRecord(options: {
  record: CandidateRecord;
  patch: string | null;
  repoRoot?: string;
}): { jsonPath: string; markdownPath: string; patchPath: string | null } {
  const root = options.repoRoot ?? REPO_ROOT;
  const dir = path.join(root, "docs/learning/lessons/29-self-improving/traces");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `meta01-${stamp}`);
  const jsonPath = `${base}.json`;
  const markdownPath = `${base}.md`;
  fs.writeFileSync(jsonPath, `${JSON.stringify(options.record, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderRecord(options.record));
  let patchPath: string | null = null;
  if (options.patch !== null) {
    patchPath = `${base}.patch`;
    fs.writeFileSync(
      patchPath,
      options.patch.endsWith("\n") ? options.patch : `${options.patch}\n`,
    );
  }
  return { jsonPath, markdownPath, patchPath };
}

export function emptyRecord(options: {
  candidateId: string;
  configuredModel: string;
}): CandidateRecord {
  return {
    experimentId: META01_EXPERIMENT_ID,
    parentRevision: META01_PARENT_REVISION,
    candidateRevision: null,
    candidateRef: null,
    candidateId: options.candidateId,
    configuredModel: options.configuredModel,
    hypothesis: null,
    allowedMutationFiles: [
      "harness/src/loop.ts",
      "harness/src/loop-ext/<new>.ts",
    ],
    changedFiles: [],
    patchHash: null,
    patchStats: null,
    integrityChecks: [],
    authorityIntegrity: null,
    regressionEvidence: { h0: [], h1: [] },
    maintenanceBaselineEvidence: [],
    maintenanceCandidateEvidence: [],
    pristineH0: null,
    pristineH1: null,
    decision: "candidate_rejected",
    decisionReasons: [],
    mainUnchanged: null,
  };
}

function renderRecord(record: CandidateRecord): string {
  const hypothesis = record.hypothesis
    ? [
        `observedProblem: ${record.hypothesis.observedProblem}`,
        `suspectedCause: ${record.hypothesis.suspectedCause}`,
        `proposedMutation: ${record.hypothesis.proposedMutation}`,
        `expectedBenefit: ${record.hypothesis.expectedBenefit}`,
        `expectedRisks: ${record.hypothesis.expectedRisks.join("; ")}`,
      ].join("\n")
    : "(none)";
  return [
    `# META01 ${record.candidateId}`,
    "",
    `Decision: \`${record.decision}\``,
    "",
    record.decisionReasons.map((reason) => `- ${reason}`).join("\n"),
    "",
    `Parent: \`${record.parentRevision}\``,
    `Candidate revision: \`${record.candidateRevision ?? "(not materialized)"}\``,
    `Candidate ref: \`${record.candidateRef ?? "(none)"}\``,
    `Patch hash: \`${record.patchHash ?? "(none)"}\``,
    `Model: \`${record.configuredModel}\``,
    `Main unchanged: ${String(record.mainUnchanged)}`,
    "",
    "## Hypothesis",
    "",
    hypothesis,
    "",
    "## Patch",
    "",
    renderPatch(record),
    "",
    "## Integrity",
    "",
    record.integrityChecks
      .map(
        (check) =>
          `- ${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.evidence}`,
      )
      .join("\n") || "(not run)",
    "",
    "## Authority integrity",
    "",
    renderAuthority(record),
    "",
    "## Regression",
    "",
    renderRegression("H0", record.regressionEvidence.h0),
    "",
    renderRegression("H1", record.regressionEvidence.h1),
    "",
    "## Maintenance",
    "",
    renderTrials("H0", record.maintenanceBaselineEvidence),
    "",
    renderTrials("H1", record.maintenanceCandidateEvidence),
    "",
  ].join("\n");
}

function renderAuthority(record: CandidateRecord): string {
  if (!record.authorityIntegrity) {
    return "(not run)";
  }
  const result = record.authorityIntegrity;
  return [
    `staticDiffPassed: ${result.staticDiffPassed}`,
    `behavioralInvariantsPassed: ${result.behavioralInvariantsPassed}`,
    result.findings.length === 0
      ? "findings: (none)"
      : `findings: ${result.findings.join(" | ")}`,
  ].join("\n");
}

function renderPatch(record: CandidateRecord): string {
  if (!record.patchStats) {
    return "(none)";
  }
  return [
    `files: ${record.changedFiles.join(", ") || "(none)"}`,
    `additions: ${record.patchStats.additions}`,
    `deletions: ${record.patchStats.deletions}`,
    `new modules: ${record.patchStats.newModules.join(", ") || "(none)"}`,
    `new feature branches: ${record.patchStats.newFeatureBranches}`,
  ].join("\n");
}

function renderRegression(
  arm: string,
  results: RegressionCommandResult[],
): string {
  if (results.length === 0) {
    return `### ${arm}\n\n(not run)`;
  }
  const lines = results.map(
    (result) =>
      `| ${result.id} | ${result.passed ? "PASS" : "FAIL"} | ${result.exitCode ?? "null"} | ${result.durationMs} |`,
  );
  return [
    `### ${arm}`,
    "",
    "| Task | Result | Exit | Ms |",
    "| --- | --- | ---: | ---: |",
    ...lines,
  ].join("\n");
}

function renderTrials(arm: string, trials: TrialMetric[]): string {
  if (trials.length === 0) {
    return `### ${arm}\n\n(not run)`;
  }
  const lines = trials.map(
    (trial) =>
      `| ${trial.externalGraderPassed ? "PASS" : "FAIL"} | ${trial.coreFunctionsTouched.join(", ") || "(none)"} | ${trial.loopChangedLines} | ${trial.totalChangedLines} | ${trial.modelCalls} | ${trial.toolCalls} | ${trial.wallTimeMs} |`,
  );
  return [
    `### ${arm}`,
    "",
    "| Grader | Core functions | Loop lines | Total lines | Model | Tools | Ms |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...lines,
  ].join("\n");
}
