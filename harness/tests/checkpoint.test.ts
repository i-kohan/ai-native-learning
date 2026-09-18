import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT, type HarnessConfig } from "../src/config.ts";
import {
  reviewDeltaIdentity,
  reviewDeltasMatch,
  snapshotDirectory,
} from "../src/diff.ts";
import {
  loadReviewBaseline,
  persistReviewBaseline,
  reviewBaselinePath,
} from "../src/review-baseline.ts";
import { runV1Harness } from "../src/run.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  captureWorkspaceResumeEvidence,
} from "../src/workspace.ts";
import { WorkflowError } from "../src/workflow-error.ts";
import {
  initializeWorkflow,
  loadWorkflowState,
  saveWorkflowStateUnfenced,
} from "../src/workflow-store.ts";
import {
  admitImplementationReady,
  admitReviewReady,
  createSpecRequiredState,
  nextDurableAction,
} from "../src/workflow-state.ts";
import type { Spec, SpecDecision } from "../src/spec.ts";
import {
  evaluateCheckpointAssertions,
  isExpectedCheckpointArmOutcome,
  type CheckpointArmEvidence,
  type CheckpointInvocationEvidence,
} from "../src/checkpoint-probe.ts";

function sampleSpec(): Spec {
  return {
    goal: "Keep completedAt in sync",
    requirements: ["Set completedAt on complete"],
    constraints: ["Do not modify tests"],
    nonGoals: ["New features"],
    acceptance: ["Existing tests pass"],
    verification: ["npm test"],
    ambiguities: [],
  };
}

function executableDecision(): Extract<SpecDecision, { status: "executable" }> {
  return { status: "executable", spec: sampleSpec() };
}

function dummyWorkspaceEvidence(root: string) {
  return {
    id: "wf-test",
    root,
    baseRevision: "abc123",
    ref: "HEAD",
    headRevision: "abc123",
    workingTreeFingerprint: "fingerprint",
  };
}

function unusedConfig(tracesDir: string): HarnessConfig {
  return {
    apiKey: "unused",
    model: "unused",
    maxTurns: 1,
    maxRepairAttempts: 2,
    maxReviewRepairAttempts: 1,
    repoRoot: REPO_ROOT,
    targetAppRoot: path.join(REPO_ROOT, "target-app"),
    targetSrcRoot: path.join(REPO_ROOT, "target-app", "src"),
    tracesDir,
  };
}

function implementationReady(workflowId = "wf-1") {
  return admitImplementationReady({
    current: createSpecRequiredState({
      workflowId,
      task: "do the thing",
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
    }),
    decision: executableDecision(),
    specInspectedPaths: { readFiles: ["src/app.ts"], listedPaths: [] },
    contextMode: "variant",
  });
}

function reviewReady(current = implementationReady()) {
  return admitReviewReady({
    current,
    workspace: {
      ...current.workspace,
      workingTreeFingerprint: "verified-b",
    },
    reviewBaseline: {
      artifactId: `${current.workflowId}.review-baseline`,
      fingerprint: "baseline-a",
    },
    verification: {
      passed: true,
      exitCode: 0,
      durationMs: 12,
      attempt: 1,
    },
  });
}

describe("review_ready admission", () => {
  it("admits implementation_ready → review_ready and dispatches continue_review", () => {
    const ready = reviewReady();
    assert.equal(ready.phase, "review_ready");
    assert.equal(nextDurableAction(ready), "continue_review");
    assert.equal(ready.verification.passed, true);
    assert.equal(ready.reviewBaseline.fingerprint, "baseline-a");
    assert.equal(ready.workspace.workingTreeFingerprint, "verified-b");
    assert.equal(ready.spec.goal, sampleSpec().goal);
  });

  it("rejects illegal review_ready transitions", () => {
    assert.throws(
      () =>
        admitReviewReady({
          current: createSpecRequiredState({
            workflowId: "wf-1",
            task: "do the thing",
            workspace: dummyWorkspaceEvidence("/tmp/ws"),
          }),
          workspace: dummyWorkspaceEvidence("/tmp/ws"),
          reviewBaseline: {
            artifactId: "wf-1.review-baseline",
            fingerprint: "baseline-a",
          },
          verification: {
            passed: true,
            exitCode: 0,
            durationMs: 1,
            attempt: 1,
          },
        }),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "illegal_transition",
    );

    const ready = reviewReady();
    assert.throws(
      () =>
        admitReviewReady({
          current: ready,
          workspace: ready.workspace,
          reviewBaseline: ready.reviewBaseline,
          verification: ready.verification,
        }),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "illegal_transition",
    );
    assert.throws(
      () =>
        admitReviewReady({
          current: implementationReady(),
          workspace: dummyWorkspaceEvidence("/tmp/ws"),
          reviewBaseline: {
            artifactId: "wf-1.review-baseline",
            fingerprint: "baseline-a",
          },
          verification: {
            passed: false as unknown as true,
            exitCode: 1,
            durationMs: 1,
            attempt: 1,
          },
        }),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "illegal_transition",
    );
  });

  it("treats crash before persist as implementation_ready", () => {
    const storeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "wf-review-commit-"),
    );
    const initial = initializeWorkflow({
      storeDir,
      workflowId: "commit-review",
      task: "task",
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
    });
    const impl = admitImplementationReady({
      current: initial,
      decision: executableDecision(),
      specInspectedPaths: { readFiles: [], listedPaths: [] },
      contextMode: "variant",
    });
    saveWorkflowStateUnfenced(storeDir, impl);
    const next = reviewReady(impl);
    assert.equal(
      loadWorkflowState(storeDir, "commit-review").phase,
      "implementation_ready",
    );
    saveWorkflowStateUnfenced(storeDir, next);
    assert.equal(
      loadWorkflowState(storeDir, "commit-review").phase,
      "review_ready",
    );
  });
});

describe("durable review baseline artifact", () => {
  it("stores the snapshot outside WorkflowState and restores it by fingerprint", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-baseline-"));
    const snapshot = new Map([
      ["tasks/task-service.ts", "export const before = 1;\n"],
    ]);
    const ref = persistReviewBaseline(storeDir, "wf-base", snapshot);
    const loaded = loadReviewBaseline(storeDir, ref);
    assert.equal(
      loaded.get("tasks/task-service.ts"),
      "export const before = 1;\n",
    );
    assert.equal(ref.artifactId, "wf-base.review-baseline");
    const state = reviewReady(implementationReady("wf-base"));
    assert.equal(state.reviewBaseline.artifactId.includes("wf-base"), true);
    assert.doesNotMatch(JSON.stringify(state), /export const before/);
  });

  it("fails closed when the baseline artifact is missing or tampered", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-baseline-bad-"));
    const snapshot = new Map([["a.ts", "one"]]);
    const ref = persistReviewBaseline(storeDir, "wf-bad", snapshot);
    fs.unlinkSync(reviewBaselinePath(storeDir, "wf-bad"));
    assert.throws(
      () => loadReviewBaseline(storeDir, ref),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "missing_state",
    );

    persistReviewBaseline(storeDir, "wf-bad", snapshot);
    fs.writeFileSync(
      reviewBaselinePath(storeDir, "wf-bad"),
      `${JSON.stringify({
        schemaVersion: 1,
        artifactId: ref.artifactId,
        kind: "pre_worker_file_snapshot",
        fingerprint: ref.fingerprint,
        files: { "a.ts": "tampered" },
      })}\n`,
    );
    assert.throws(
      () => loadReviewBaseline(storeDir, ref),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "corrupt_state",
    );
  });
});

describe("review_ready workspace mismatch", () => {
  it("fails closed and does not start REVIEW after B is mutated to C", async () => {
    const id = `chk-mismatch-${Date.now()}`;
    const workspace = createWorkspace({ hostRepoRoot: REPO_ROOT, id });
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-chk-mismatch-"));
    try {
      const before = snapshotDirectory(
        path.join(workspace.root, "target-app", "src"),
      );
      const evidenceA = captureWorkspaceResumeEvidence(workspace);
      const initial = initializeWorkflow({
        storeDir,
        workflowId: "chk-mismatch",
        task: "task",
        workspace: evidenceA,
      });
      const impl = admitImplementationReady({
        current: initial,
        decision: executableDecision(),
        specInspectedPaths: { readFiles: [], listedPaths: [] },
        contextMode: "variant",
      });
      const baseline = persistReviewBaseline(storeDir, impl.workflowId, before);
      const mutated = path.join(
        workspace.root,
        "target-app/src/tasks/task-service.ts",
      );
      fs.appendFileSync(mutated, "\n// verified artifact B\n");
      const evidenceB = captureWorkspaceResumeEvidence(workspace);
      saveWorkflowStateUnfenced(
        storeDir,
        admitReviewReady({
          current: impl,
          workspace: evidenceB,
          reviewBaseline: baseline,
          verification: {
            passed: true,
            exitCode: 0,
            durationMs: 1,
            attempt: 1,
          },
        }),
      );
      fs.appendFileSync(mutated, "\n// dirty artifact C\n");

      await assert.rejects(
        () =>
          runV1Harness({
            config: unusedConfig(storeDir),
            task: "task",
            runId: "chk-mismatch-run",
            durable: { workflowId: "chk-mismatch", storeDir },
          }),
        (error: unknown) =>
          error instanceof WorkflowError && error.code === "workspace_mismatch",
      );

      const traces = fs
        .readdirSync(storeDir)
        .filter((name) => name.endsWith(".jsonl"));
      for (const name of traces) {
        const text = fs.readFileSync(path.join(storeDir, name), "utf8");
        assert.equal(text.includes("review_started"), false);
      }
    } finally {
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
    }
  });
});

describe("CHK01 decision rule", () => {
  it("fingerprints the same changed files and normalized diff identically", () => {
    const left = reviewDeltaIdentity(
      ["tasks/task-service.ts"],
      "--- tasks/task-service.ts\n+a\n",
    );
    const right = reviewDeltaIdentity(
      ["tasks/task-service.ts"],
      "--- tasks/task-service.ts\n+a\n",
    );
    assert.equal(reviewDeltasMatch(left, right), true);
    assert.equal(
      reviewDeltasMatch(
        left,
        reviewDeltaIdentity(
          ["tasks/task-service.ts"],
          "--- tasks/task-service.ts\n+b\n",
        ),
      ),
      false,
    );
  });
  it("passes only when A persisted review_ready and B skipped Worker plus pre-review VERIFY", () => {
    const assertions = evaluateCheckpointAssertions(
      passingControlArm(),
      passingInterruptedArm(),
    );
    assert.equal(assertions.processAPersistedReviewReady, true);
    assert.equal(assertions.processBDidNotRerunWorker, true);
    assert.equal(assertions.processBDidNotRerunPreReviewVerify, true);
    assert.equal(assertions.processBReconstructedDiffIdentity, true);
    assert.equal(Object.values(assertions).every(Boolean), true);
  });

  it("fails if reconstructed changedFiles differ", () => {
    const mismatchedFiles = passingInterruptedArm();
    mismatchedFiles.invocations[1].changedFiles = ["tasks/task-routes.ts"];
    const assertions = evaluateCheckpointAssertions(
      passingControlArm(),
      mismatchedFiles,
    );
    assert.equal(assertions.processBReconstructedDiffIdentity, false);
    assert.equal(assertions.processBReconstructedBaseline, true);
  });

  it("fails if diff contents differ while remaining non-empty", () => {
    const mismatchedDiff = passingInterruptedArm();
    mismatchedDiff.invocations[1].diffFingerprint = "bbbbbbbbbbbbbbbb";
    const assertions = evaluateCheckpointAssertions(
      passingControlArm(),
      mismatchedDiff,
    );
    assert.equal(assertions.processBReconstructedDiffIdentity, false);
    assert.equal(
      mismatchedDiff.invocations[1].changedFiles.length > 0,
      true,
    );
    assert.equal(assertions.processBReconstructedBaseline, true);
  });

  it("fails when B reruns Worker or pre-review VERIFY", () => {
    const reranWorker = passingInterruptedArm();
    reranWorker.invocations[1].implementationStarted = true;
    reranWorker.invocations[1].implementationSkipped = false;
    reranWorker.workerSkippedCount = 0;
    const workerAssertions = evaluateCheckpointAssertions(
      passingControlArm(),
      reranWorker,
    );
    assert.equal(workerAssertions.processBDidNotRerunWorker, false);

    const reranVerify = passingInterruptedArm();
    reranVerify.verifyBeforeReview = ["PASS"];
    reranVerify.processBVerifyBeforeReview = ["PASS"];
    reranVerify.invocations[1].preReviewVerifySkipped = false;
    reranVerify.preReviewVerifySkippedCount = 0;
    const verifyAssertions = evaluateCheckpointAssertions(
      passingControlArm(),
      reranVerify,
    );
    assert.equal(verifyAssertions.processBDidNotRerunPreReviewVerify, false);
  });

  it("does not count expected success without independent REVIEW pass", () => {
    assert.equal(
      isExpectedCheckpointArmOutcome(
        passingProcessB({ finalReviewerOutcome: "findings" }),
        [{ reviewOutcomes: ["findings"] }],
      ),
      false,
    );
    assert.equal(
      isExpectedCheckpointArmOutcome(passingProcessB(), [
        { reviewOutcomes: ["pass"] },
      ]),
      true,
    );
  });
});

function passingControlArm(): CheckpointArmEvidence {
  return {
    workflowId: "CHK01-control",
    workspaceId: "ws",
    workspaceRoot: "/tmp/ws",
    baseRevision: "abc",
    workingTreeFingerprint: "fp",
    invocations: [
      passingProcessB({
        workflowId: "CHK01-control",
        invocationId: "control",
        pid: 3,
        phaseOnStart: "spec_required",
        implementationStarted: true,
        implementationSkipped: false,
        preReviewVerifySkipped: false,
        reviewBaselineRestored: false,
      }),
    ],
    specPhaseStartedCount: 1,
    specPhaseSkippedCount: 0,
    workerStartedCount: 1,
    workerSkippedCount: 0,
    preReviewVerifySkippedCount: 0,
    verifyBeforeReview: ["PASS"],
    processBVerifyBeforeReview: ["PASS"],
    verifyAfterReview: [],
    reviewOutcomes: ["pass"],
    reviewStartedCount: 1,
    reviewBaselineRestoredCount: 0,
    reviewVerificationPassedCount: 1,
    terminalPhase: "terminal",
    expectedOutcomeMet: true,
    expectedReviewDelta: null,
  };
}

function passingInterruptedArm(): CheckpointArmEvidence {
  return {
    workflowId: "CHK01-interrupted",
    workspaceId: "ws",
    workspaceRoot: "/tmp/ws",
    baseRevision: "abc",
    workingTreeFingerprint: "fp",
    invocations: [passingProcessA(), passingProcessB()],
    specPhaseStartedCount: 0,
    specPhaseSkippedCount: 1,
    workerStartedCount: 1,
    workerSkippedCount: 1,
    preReviewVerifySkippedCount: 1,
    verifyBeforeReview: [],
    processBVerifyBeforeReview: [],
    verifyAfterReview: [],
    reviewOutcomes: ["pass"],
    reviewStartedCount: 1,
    reviewBaselineRestoredCount: 1,
    reviewVerificationPassedCount: 1,
    terminalPhase: "terminal",
    expectedOutcomeMet: true,
    expectedReviewDelta: {
      changedFiles: ["tasks/task-service.ts"],
      diffFingerprint: "aaaaaaaaaaaaaaaa",
    },
  };
}

function passingProcessA(): CheckpointInvocationEvidence {
  return {
    workflowId: "CHK01-interrupted",
    invocationId: "A",
    pid: 1,
    ppid: 0,
    phaseOnStart: "implementation_ready",
    phaseOnExit: "review_ready",
    stopAfter: "review_ready",
    workflowStatus: "paused",
    specDecision: "executable",
    implementationStarted: true,
    specModelCalls: 0,
    specToolCalls: 0,
    durableCheckpoint: "review_ready",
    implementationSkipped: false,
    preReviewVerifySkipped: false,
    reviewBaselineRestored: false,
    reviewAttempts: 0,
    tracePath: "",
    finalVerificationPassed: true,
    finalReviewerOutcome: "skipped",
    workspaceId: "ws",
    workspaceRoot: "/tmp/ws",
    baseRevision: "abc",
    changedFiles: ["tasks/task-service.ts"],
    diffFingerprint: "aaaaaaaaaaaaaaaa",
  };
}

function passingProcessB(
  overrides: Partial<CheckpointInvocationEvidence> = {},
): CheckpointInvocationEvidence {
  return {
    workflowId: "CHK01-interrupted",
    invocationId: "B",
    pid: 2,
    ppid: 0,
    phaseOnStart: "review_ready",
    phaseOnExit: "terminal",
    stopAfter: null,
    workflowStatus: "success",
    specDecision: "executable",
    implementationStarted: false,
    specModelCalls: 0,
    specToolCalls: 0,
    durableCheckpoint: null,
    implementationSkipped: true,
    preReviewVerifySkipped: true,
    reviewBaselineRestored: true,
    reviewAttempts: 1,
    tracePath: "",
    finalVerificationPassed: true,
    finalReviewerOutcome: "pass",
    workspaceId: "ws",
    workspaceRoot: "/tmp/ws",
    baseRevision: "abc",
    changedFiles: ["tasks/task-service.ts"],
    diffFingerprint: "aaaaaaaaaaaaaaaa",
    ...overrides,
  };
}
