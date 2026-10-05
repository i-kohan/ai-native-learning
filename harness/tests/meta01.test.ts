import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { decideMeta01, type DecisionInput } from "../src/meta01/decision.ts";
import {
  captureDefaultEpisode,
  gradeCapability,
} from "../src/meta01/grader.ts";
import { buildImproverPrompt } from "../src/meta01/improver.ts";
import {
  assessAuthorityIntegrity,
  runAuthorityInvariants,
} from "../src/meta01/authority.ts";
import { evaluateIntegrity } from "../src/meta01/integrity.ts";
import {
  readMaintenance,
  writeMaintenance,
} from "../src/meta01/maintenance-agent.ts";
import {
  LOCAL_INSPECTION_SIGNAL,
  LOCAL_INSPECTION_SIGNAL_VALUE,
} from "../src/meta01/maintenance-adapter.ts";
import {
  LOCAL_INSPECTION_DENIAL,
  LOCAL_INSPECTION_INSTRUCTION,
  LOCAL_INSPECTION_TOOL,
  inspectedOutput,
} from "../src/meta01/maintenance-task.ts";
import { median, type TrialMetric } from "../src/meta01/metrics.ts";
import {
  collectWorktreePatch,
  coreFunctionsTouched,
} from "../src/meta01/patch.ts";
import { evaluateAdmitted } from "../src/meta01/probe.ts";
import { META01_PARENT_REVISION } from "../src/meta01/policy.ts";
import { emptyRecord, writeCandidateRecord } from "../src/meta01/record.ts";
import {
  materializeCandidateRevision,
  provenanceMatches,
} from "../src/meta01/revision.ts";
import {
  createCandidateSession,
  submitHypothesis,
  writeCandidateFile,
} from "../src/meta01/session.ts";
import { runAgentLoop, type ResponsesCreateFn } from "../src/loop.ts";

const AUTHOR_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "meta01",
  GIT_AUTHOR_EMAIL: "meta01@example.com",
  GIT_COMMITTER_NAME: "meta01",
  GIT_COMMITTER_EMAIL: "meta01@example.com",
};

describe("META01 candidate boundary", () => {
  it("denies a write before an accepted hypothesis", () => {
    const root = tempRepo();
    try {
      const session = createCandidateSession({
        workspaceRoot: root,
        parentRevision: META01_PARENT_REVISION,
      });
      const result = writeCandidateFile(
        session,
        "harness/src/loop-ext/extra.ts",
        "export const extra = 1;\n",
      );
      assert.equal(result.ok, false);
      assert.match(result.message, /hypothesis has not been accepted/);
      assert.equal(
        fs.existsSync(path.join(root, "harness/src/loop-ext/extra.ts")),
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a second hypothesis and an invalid hypothesis", () => {
    const root = tempRepo();
    try {
      const session = createCandidateSession({
        workspaceRoot: root,
        parentRevision: META01_PARENT_REVISION,
      });
      const invalid = submitHypothesis(session, {});
      assert.equal(invalid.ok, false);
      assert.match(invalid.message, /invalid ImprovementHypothesis/);
      const second = submitHypothesis(session, hypothesis());
      assert.equal(second.ok, false);
      assert.match(second.message, /only one submission/);
      const write = writeCandidateFile(
        session,
        "harness/src/loop.ts",
        "export const changed = true;\n",
      );
      assert.equal(write.ok, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("denies a non-allowlisted write and path traversal", () => {
    const root = tempRepo();
    try {
      const session = acceptedSession(root);
      const outside = writeCandidateFile(
        session,
        "harness/src/run.ts",
        "export const no = true;\n",
      );
      assert.equal(outside.ok, false);
      assert.match(outside.message, /mutation boundary/);
      const traversal = writeCandidateFile(
        session,
        "harness/src/../../outside.ts",
        "export const no = true;\n",
      );
      assert.equal(traversal.ok, false);
      assert.match(traversal.message, /traversal/i);
      const evaluator = writeCandidateFile(
        session,
        "harness/src/eval/grader.ts",
        "export const no = true;\n",
      );
      assert.equal(evaluator.ok, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores untracked directories when measuring a patch", () => {
    const root = tempRepo();
    try {
      fs.mkdirSync(path.join(root, "harness/src/loop-ext"));
      fs.symlinkSync(root, path.join(root, "harness/node_modules"));
      const patch = collectWorktreePatch(root);
      assert.deepEqual(patch.files, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("enforces the patch line budget and create-only overwrite rule", () => {
    const root = tempRepo();
    try {
      const session = acceptedSession(root);
      const huge = `export const huge = 1;\n${"const line = 1;\n".repeat(320)}`;
      const over = writeCandidateFile(session, "harness/src/loop.ts", huge);
      assert.equal(over.ok, false);
      assert.match(over.message, /patch budget exceeded/);
      assert.doesNotMatch(
        fs.readFileSync(path.join(root, "harness/src/loop.ts"), "utf8"),
        /huge/,
      );
      fs.mkdirSync(path.join(root, "harness/src/loop-ext"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, "harness/src/loop-ext/kept.ts"),
        "export const kept = 1;\n",
      );
      git(root, ["add", "--", "harness/src/loop-ext/kept.ts"]);
      git(root, ["commit", "-m", "existing extra"]);
      const overwrite = writeCandidateFile(
        session,
        "harness/src/loop-ext/kept.ts",
        "export const kept = 2;\n",
      );
      assert.equal(overwrite.ok, false);
      assert.match(overwrite.message, /only loop.ts may overwrite/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("META01 integrity and admission", () => {
  it("rejects an exact-base mismatch and a forbidden-file patch", () => {
    const mismatch = evaluateIntegrity({
      baseRevision: "abc",
      changedFiles: ["harness/src/loop.ts"],
      additions: 10,
      deletions: 2,
      hypothesisAcceptedBeforeFirstWrite: true,
      hasMutation: true,
      authorityIntegrity: clearAuthority(),
    });
    assert.equal(mismatch.passed, false);
    assert.equal(
      mismatch.checks.find((check) => check.id === "exact_base")?.passed,
      false,
    );

    const forbidden = evaluateIntegrity({
      baseRevision: META01_PARENT_REVISION,
      changedFiles: ["harness/src/loop.ts", "harness/src/eval/grader.ts"],
      additions: 10,
      deletions: 1,
      hypothesisAcceptedBeforeFirstWrite: true,
      hasMutation: true,
      authorityIntegrity: clearAuthority(),
    });
    assert.equal(forbidden.passed, false);
    assert.equal(
      forbidden.checks.find((check) => check.id === "forbidden_files_unchanged")
        ?.passed,
      false,
    );
  });

  it("does not run expensive evaluation after a failed integrity gate", async () => {
    let calls = 0;
    const skipped = await evaluateAdmitted(false, async () => {
      calls += 1;
      return "ran";
    });
    assert.equal(skipped, null);
    assert.equal(calls, 0);
  });
});

describe("META01 revision provenance", () => {
  it("materializes a detached candidate revision without moving the branch", () => {
    const root = tempRepo();
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "meta01-wt-"));
    try {
      const parent = git(root, ["rev-parse", "HEAD"]).trim();
      const branchBefore = git(root, ["rev-parse", "main"]).trim();
      git(root, ["worktree", "add", "--detach", worktree, parent]);
      fs.writeFileSync(
        path.join(worktree, "harness/src/loop.ts"),
        "export async function runAgentLoop() { return 1; }\n",
      );
      const revision = materializeCandidateRevision({
        hostRepoRoot: root,
        workspaceRoot: worktree,
        candidateId: "fixture",
        expectedParent: parent,
      });
      assert.equal(git(root, ["rev-parse", "main"]).trim(), branchBefore);
      assert.equal(revision.parentRevision, parent);
      assert.notEqual(revision.candidateRevision, parent);
      assert.equal(revision.mainUnchanged, true);
      const proved = provenanceMatches({
        parentRevision: parent,
        candidateRevision: revision.candidateRevision,
        patchHash: revision.patchHash,
        hostRepoRoot: root,
        expectedParent: parent,
      });
      assert.equal(proved.ok, true);
      const record = emptyRecord({
        candidateId: "fixture",
        configuredModel: "test-model",
      });
      record.parentRevision = parent;
      record.candidateRevision = revision.candidateRevision;
      record.patchHash = revision.patchHash;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta01-record-"));
      const written = writeCandidateRecord({
        record,
        patch: revision.patch,
        repoRoot: dir,
      });
      const stored = JSON.parse(fs.readFileSync(written.jsonPath, "utf8")) as {
        parentRevision: string;
        candidateRevision: string;
        patchHash: string;
      };
      assert.equal(stored.parentRevision, parent);
      assert.equal(stored.candidateRevision, revision.candidateRevision);
      assert.equal(stored.patchHash, revision.patchHash);
      fs.rmSync(dir, { recursive: true, force: true });
    } finally {
      spawnSync("git", ["worktree", "remove", "--force", worktree], {
        cwd: root,
      });
      fs.rmSync(worktree, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("META01 maintenance authority", () => {
  it("denies grader, eval, and test writes", () => {
    const root = tempRepo();
    try {
      fs.mkdirSync(path.join(root, "harness/src/meta01"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "harness/src/meta01/grader.ts"),
        "export const hidden = true;\n",
      );
      assert.match(
        readMaintenance(root, "harness/src/meta01/grader.ts"),
        /read denied/,
      );
      assert.match(
        writeMaintenance(
          root,
          "harness/src/eval/grader.ts",
          "export const no = true;\n",
        ),
        /write denied/,
      );
      assert.match(
        writeMaintenance(
          root,
          "harness/tests/meta01.test.ts",
          "export const no = true;\n",
        ),
        /write denied/,
      );
      assert.match(
        writeMaintenance(root, "../secret.ts", "export const no = true;\n"),
        /traversal|Absolute/i,
      );
      assert.match(
        writeMaintenance(
          root,
          "harness/src/loop.ts",
          "export const changed = true;\n",
        ),
        /^wrote /,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("META01 grader", () => {
  it("passes a contract implementation and fails a missing capability", async () => {
    const snapshot = await captureDefaultEpisode(contractLoop(true));
    assert.equal(snapshot.threw, false);
    const grade = await gradeCapability(snapshot, contractLoop(true));
    assert.deepEqual(grade.reasons, []);
    const missing = await gradeCapability(snapshot, contractLoop(false));
    assert.equal(missing.passed, false);
    assert.equal(missing.reasons.includes("capability_missing"), true);
  });

  it("keeps the current default loop readable when the signal is off", async () => {
    const snapshot = await captureDefaultEpisode(runAgentLoop);
    assert.equal(snapshot.threw, false);
    assert.equal(snapshot.status, "success");
    assert.equal(snapshot.toolNames.includes(LOCAL_INSPECTION_TOOL), false);
  });
});

describe("META01 decision rule", () => {
  it("stops when H0 regression evidence is insufficient", () => {
    const decision = decideMeta01({
      ...passingInput(),
      insufficientRegressionEvidence: true,
      h0RegressionConfirmed: false,
    });
    assert.equal(
      decision.decision,
      "experiment_stopped_insufficient_regression_evidence",
    );
  });

  it("accepts only the frozen structural outcome", () => {
    assert.equal(
      decideMeta01(passingInput()).decision,
      "candidate_accepted_for_this_workload",
    );
  });

  it("marks mixed structural evidence promising when provenance is valid", () => {
    const input = passingInput();
    input.h1 = input.h1.map((trial) => ({ ...trial, totalChangedLines: 40 }));
    assert.equal(
      decideMeta01(input).decision,
      "candidate_promising_but_inconclusive",
    );
  });

  it("rejects invalid provenance instead of calling it promising", () => {
    const input = passingInput();
    input.h1 = input.h1.map((trial) => ({ ...trial, totalChangedLines: 40 }));
    input.provenance = "invalid";
    const decided = decideMeta01(input);
    assert.equal(decided.decision, "candidate_rejected");
    assert.match(decided.reasons.join(" "), /provenance/);
  });

  it("rejects a clean result that does not reduce core-loop coupling", () => {
    const input = passingInput();
    input.h1 = input.h1.map((trial) => ({
      ...trial,
      coreFunctionsTouched: [
        "runAgentLoop",
        "episodeInstructions",
        "executeWorkerTool",
      ],
    }));
    assert.equal(decideMeta01(input).decision, "candidate_rejected");
  });

  it("does not let the candidate supply its own verdict", () => {
    const input = passingInput();
    input.h1 = input.h1.map((trial) => ({ ...trial, totalChangedLines: 40 }));
    const smuggled = input as DecisionInput & { selfDecision?: string };
    smuggled.selfDecision = "candidate_accepted_for_this_workload";
    assert.equal(
      decideMeta01(smuggled).decision,
      "candidate_promising_but_inconclusive",
    );
  });

  it("rejects a pristine architecture fault before maintenance metrics matter", () => {
    const decision = decideMeta01({
      ...passingInput(),
      pristineArchitectureFault: true,
      h0: [],
      h1: [],
    });
    assert.equal(decision.decision, "candidate_rejected");
    assert.match(decision.reasons.join(" "), /pristine/);
  });
});

describe("META01 improver isolation", () => {
  it("does not reveal the maintenance contract to the improver prompt", () => {
    const prompt = buildImproverPrompt();
    const source = fs.readFileSync(
      new URL("../src/meta01/improver.ts", import.meta.url),
      "utf8",
    );
    for (const secret of [
      LOCAL_INSPECTION_TOOL,
      LOCAL_INSPECTION_SIGNAL,
      "maintenance-task",
      "grade-child",
      "boundedLocalInspection",
    ]) {
      assert.equal(prompt.includes(secret), false, secret);
      assert.equal(source.includes(secret), false, secret);
    }
  });
});

describe("META01 authority integrity", () => {
  it("rejects a deletion-only removal of a delegation gate", () => {
    const authority = assessAuthorityIntegrity({
      addedLines: ["return delegate();"],
      removedLines: ["if (remainingDelegations <= 0) {", "return deny();"],
      behavior: {
        passed: false,
        findings: ["research budget: second delegation was not denied"],
        verifiedGuardIds: ["research_budget"],
      },
    });
    assert.equal(authority.staticDiffPassed, true);
    assert.equal(authority.behavioralInvariantsPassed, false);
    assert.match(authority.findings.join("\n"), /removed: research_budget/);
    const integrity = evaluateIntegrity({
      baseRevision: META01_PARENT_REVISION,
      changedFiles: ["harness/src/loop.ts"],
      additions: 1,
      deletions: 2,
      hypothesisAcceptedBeforeFirstWrite: true,
      hasMutation: true,
      authorityIntegrity: authority,
    });
    assert.equal(integrity.passed, false);
    assert.equal(
      integrity.checks.find((check) => check.id === "authority_unchanged")
        ?.passed,
      false,
    );
  });

  it("allows a guard that moved when the same behavior still holds", () => {
    const authority = assessAuthorityIntegrity({
      addedLines: ["if (state.remainingDelegations <= 0) {"],
      removedLines: ["if (remainingDelegations <= 0) {"],
      behavior: {
        passed: true,
        findings: [],
        verifiedGuardIds: ["research_budget"],
      },
    });
    assert.equal(authority.staticDiffPassed, true);
    assert.equal(authority.behavioralInvariantsPassed, true);
    assert.match(authority.findings.join("\n"), /moved: research_budget/);
    const integrity = evaluateIntegrity({
      baseRevision: META01_PARENT_REVISION,
      changedFiles: [
        "harness/src/loop.ts",
        "harness/src/loop-ext/capabilities.ts",
      ],
      additions: 1,
      deletions: 1,
      hypothesisAcceptedBeforeFirstWrite: true,
      hasMutation: true,
      authorityIntegrity: authority,
    });
    assert.equal(
      integrity.checks.find((check) => check.id === "authority_unchanged")
        ?.passed,
      true,
    );
  });

  it("rejects an optional tool that leaks into repair", () => {
    const authority = assessAuthorityIntegrity({
      addedLines: [],
      removedLines: [],
      behavior: {
        passed: false,
        findings: ["phase leak: repair exposed delegate_research"],
        verifiedGuardIds: ["subagents_opt_in"],
      },
    });
    assert.equal(authority.behavioralInvariantsPassed, false);
  });

  it("rejects a default-off capability that becomes available", () => {
    const authority = assessAuthorityIntegrity({
      addedLines: [],
      removedLines: [],
      behavior: {
        passed: false,
        findings: ["default-off: tools were list_files, delegate_research"],
        verifiedGuardIds: ["subagents_opt_in"],
      },
    });
    assert.equal(authority.behavioralInvariantsPassed, false);
  });

  it("fail-closes when a removed MCP guard cannot be behaviorally verified", () => {
    const authority = assessAuthorityIntegrity({
      addedLines: [],
      removedLines: [
        'output: "read_file is not exposed for this episode. Use repo_read_file."',
      ],
      behavior: {
        passed: true,
        findings: [],
        verifiedGuardIds: [
          "subagents_opt_in",
          "research_budget",
          "mcp_unadmitted",
          "a2a_budget",
        ],
      },
    });
    assert.equal(authority.behavioralInvariantsPassed, false);
    assert.match(
      authority.findings.join("\n"),
      /unverified: mcp_direct_read_closed/,
    );
  });

  it("keeps the current loop inside the authority invariants", async () => {
    const behavior = await runAuthorityInvariants(runAgentLoop);
    assert.deepEqual(behavior.findings, []);
    assert.equal(behavior.passed, true);
  });
});

describe("META01 core function diff", () => {
  it("counts only changed frozen function bodies", () => {
    const before =
      "export async function runAgentLoop() { return 1; }\nfunction episodeInstructions() { return 'a'; }\nfunction executeWorkerTool() { return 1; }\n";
    const after =
      "export async function runAgentLoop() { return 2; }\nfunction episodeInstructions() { return 'a'; }\nfunction executeWorkerTool() { return 1; }\n";
    assert.deepEqual(coreFunctionsTouched(before, after), ["runAgentLoop"]);
    assert.equal(median([3, 1, 2]), 2);
  });
});

function clearAuthority() {
  return {
    staticDiffPassed: true,
    behavioralInvariantsPassed: true,
    findings: [],
  };
}

function hypothesis() {
  return {
    observedProblem:
      "The loop mixes optional worker capabilities into its core.",
    suspectedCause:
      "Instruction, tool, and budget branches live inside the loop.",
    proposedMutation: "Move optional composition behind one boundary.",
    expectedBenefit: "A later capability touches fewer core functions.",
    expectedRisks: ["Behavior of an existing capability could drift."],
  };
}

function acceptedSession(root: string) {
  const session = createCandidateSession({
    workspaceRoot: root,
    parentRevision: META01_PARENT_REVISION,
  });
  const submitted = submitHypothesis(session, hypothesis());
  assert.equal(submitted.ok, true);
  return session;
}

function tempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta01-repo-"));
  git(root, ["init", "-b", "main"]);
  fs.mkdirSync(path.join(root, "harness/src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "harness/src/loop.ts"),
    "export async function runAgentLoop() { return 0; }\n",
  );
  git(root, ["add", "--", "harness/src/loop.ts"]);
  git(root, ["commit", "-m", "base"]);
  return root;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: AUTHOR_ENV,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git failed");
  }
  return result.stdout;
}

function trial(overrides: Partial<TrialMetric> = {}): TrialMetric {
  return {
    externalGraderPassed: true,
    changedFiles: ["harness/src/loop.ts"],
    totalChangedLines: 20,
    loopChangedLines: 12,
    coreFunctionsTouched: [
      "runAgentLoop",
      "episodeInstructions",
      "executeWorkerTool",
    ],
    modelCalls: 4,
    toolCalls: 3,
    wallTimeMs: 1000,
    ...overrides,
  };
}

function passingInput(): DecisionInput {
  const h0 = [trial(), trial(), trial()];
  const h1 = [0, 1, 2].map((offset) =>
    trial({
      totalChangedLines: 8 + offset,
      loopChangedLines: 2 + offset,
      coreFunctionsTouched: ["runAgentLoop"],
    }),
  );
  return {
    integrityPassed: true,
    h0RegressionConfirmed: true,
    h1RegressionPassed: true,
    insufficientRegressionEvidence: false,
    authorityExpanded: false,
    forbiddenFilesMutated: false,
    pristineArchitectureFault: false,
    provenance: "valid",
    h0,
    h1,
  };
}

function contractLoop(implementsCapability: boolean): typeof runAgentLoop {
  const loop = async (options: {
    task: string;
    phase?: "implementation" | "repair" | "review_repair";
    responsesCreate?: ResponsesCreateFn;
  }) => {
    const phase = options.phase ?? "implementation";
    const enabled =
      implementsCapability &&
      process.env[LOCAL_INSPECTION_SIGNAL] === LOCAL_INSPECTION_SIGNAL_VALUE &&
      phase === "implementation";
    const create = options.responsesCreate as ResponsesCreateFn;
    let successfulUses = 0;
    let deniedUses = 0;
    let carried = "";
    let modelCalls = 0;
    let toolCalls = 0;
    while (modelCalls < 6) {
      modelCalls += 1;
      const response = await create({
        model: "grade",
        instructions: enabled
          ? `base\n${LOCAL_INSPECTION_INSTRUCTION}`
          : "base",
        input: carried ? [{ output: carried }] : [],
        tools: enabled
          ? [{ name: "read_file" }, { name: LOCAL_INSPECTION_TOOL }]
          : [{ name: "read_file" }],
      });
      const calls = (
        (response.output ?? []) as unknown as Array<Record<string, unknown>>
      ).filter((item) => item.type === "function_call");
      if (calls.length === 0) {
        return {
          status: "success",
          modelCalls,
          toolCalls,
          receivedTerminalResponse: true,
          ...(enabled
            ? { boundedLocalInspection: { successfulUses, deniedUses } }
            : {}),
        };
      }
      for (const call of calls) {
        toolCalls += 1;
        const args = JSON.parse(String(call.arguments ?? "{}")) as {
          note?: string;
        };
        if (successfulUses >= 1) {
          deniedUses += 1;
          carried = LOCAL_INSPECTION_DENIAL;
        } else {
          successfulUses += 1;
          carried = inspectedOutput(args.note ?? "");
        }
      }
    }
    throw new Error("stub exceeded turns");
  };
  return loop as unknown as typeof runAgentLoop;
}
