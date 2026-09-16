import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  classifyReviewExecutionFailure,
  decideRetry,
  DEFAULT_MAX_REVIEW_RETRY_ATTEMPTS,
  executeReviewWithRetry,
  logicalReviewId,
  parseDurableRetryState,
  reviewOperationId,
  startRetryAttempt,
  type DurableRetryState,
} from "../src/retry.ts";
import {
  evaluateRetryAssertions,
  type RetryArmEvidence,
  type RetryInvocationEvidence,
} from "../src/retry-probe.ts";
import {
  initializeWorkflow,
  loadWorkflowState,
  saveWorkflowState,
} from "../src/workflow-store.ts";
import {
  admitImplementationReady,
  admitReviewReady,
  admitReviewRetryState,
  parseWorkflowState,
} from "../src/workflow-state.ts";
import type { Spec, SpecDecision } from "../src/spec.ts";

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
    workingTreeFingerprint: "fingerprint-b",
  };
}

describe("RetryPolicy", () => {
  it("retries REVIEW transient failures while budget remains", () => {
    assert.deepEqual(
      decideRetry({
        operationKind: "review",
        failureClass: "retryable_transient",
        attemptsStarted: 1,
        maxAttempts: 2,
      }),
      { action: "retry" },
    );
  });

  it("stops when the attempt budget is exhausted", () => {
    assert.deepEqual(
      decideRetry({
        operationKind: "review",
        failureClass: "retryable_transient",
        attemptsStarted: 2,
        maxAttempts: 2,
      }),
      { action: "stop", reason: "retry_budget_exhausted" },
    );
  });

  it("does not retry VERIFY semantic/domain failures", () => {
    assert.deepEqual(
      decideRetry({
        operationKind: "verify",
        failureClass: "semantic_domain",
        attemptsStarted: 1,
        maxAttempts: 2,
      }),
      { action: "stop", reason: "semantic_domain" },
    );
  });

  it("fail-closes Worker ambiguous side effects instead of blind retry", () => {
    const decision = decideRetry({
      operationKind: "worker",
      failureClass: "ambiguous_side_effect",
      attemptsStarted: 1,
      maxAttempts: 3,
    });
    assert.notEqual(decision.action, "retry");
    assert.deepEqual(decision, {
      action: "needs_reconciliation",
      reason: "worker_ambiguous_side_effect",
    });
  });

  it("stops on permanent/policy failures", () => {
    assert.deepEqual(
      decideRetry({
        operationKind: "review",
        failureClass: "permanent_policy",
        attemptsStarted: 1,
        maxAttempts: 2,
      }),
      { action: "stop", reason: "permanent_policy" },
    );
  });

  it("classifies REVIEW provider/execution failure as retryable_transient", () => {
    assert.equal(
      classifyReviewExecutionFailure("model_error"),
      "retryable_transient",
    );
    assert.equal(
      classifyReviewExecutionFailure("invalid_review"),
      "semantic_domain",
    );
  });
});

describe("durable REVIEW retry state", () => {
  it("keeps a stable logical operationId across attempts", () => {
    const operationId = reviewOperationId(
      "wf-1",
      logicalReviewId("wf-1.review-baseline", 1),
    );
    assert.equal(operationId, "wf-1:review:wf-1.review-baseline:round-1");
    const first = startRetryAttempt({
      current: undefined,
      operationId,
      operationKind: "review",
      maxAttempts: DEFAULT_MAX_REVIEW_RETRY_ATTEMPTS,
    });
    const second = startRetryAttempt({
      current: first,
      operationId,
      operationKind: "review",
      maxAttempts: DEFAULT_MAX_REVIEW_RETRY_ATTEMPTS,
    });
    assert.equal(first.operationId, second.operationId);
    assert.equal(first.attemptsStarted, 1);
    assert.equal(second.attemptsStarted, 2);
  });

  it("persists attemptsStarted before execution", async () => {
    const events: string[] = [];
    const result = await executeReviewWithRetry({
      operationId: "wf-1:review:round-1",
      currentRetry: undefined,
      persistRetry: (retry) => {
        events.push(`persist:${retry?.attemptsStarted ?? 0}`);
      },
      runReview: async () => {
        events.push("run");
        return { result: { status: "pass" } };
      },
    });
    assert.equal(result.status, "completed");
    assert.deepEqual(events, ["persist:1", "run", "persist:0"]);
  });

  it("injects a transient first failure then admits a second attempt", async () => {
    let runs = 0;
    const persisted: Array<DurableRetryState | undefined> = [];
    const result = await executeReviewWithRetry({
      operationId: "wf-1:review:round-1",
      currentRetry: undefined,
      injectTransientOnAttempt: 1,
      persistRetry: (retry) => {
        persisted.push(retry);
      },
      runReview: async () => {
        runs += 1;
        return { result: { status: "pass" } };
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(runs, 1);
    assert.equal(persisted[0]?.attemptsStarted, 1);
    assert.equal(persisted[1]?.lastFailureClass, "retryable_transient");
    assert.equal(persisted[2]?.attemptsStarted, 2);
    assert.equal(persisted[3], undefined);
  });

  it("can pause after retry admission so a fresh process owns the next attempt", async () => {
    const result = await executeReviewWithRetry({
      operationId: "wf-1:review:round-1",
      currentRetry: undefined,
      injectTransientOnAttempt: 1,
      stopAfterRetryAdmission: true,
      persistRetry: () => {},
      runReview: async () => {
        throw new Error("should not run REVIEW after injected failure");
      },
    });
    assert.equal(result.status, "paused");
    assert.equal(result.retry.attemptsStarted, 1);
    assert.equal(result.retry.lastFailureClass, "retryable_transient");
    assert.equal(result.decision.action, "retry");
  });

  it("round-trips retry state on review_ready without changing the checkpoint", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-retry-"));
    const initial = initializeWorkflow({
      storeDir,
      workflowId: "wf-retry",
      task: "task",
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
    });
    const impl = admitImplementationReady({
      current: initial,
      decision: executableDecision(),
      specInspectedPaths: { readFiles: [], listedPaths: [] },
      contextMode: "variant",
    });
    const ready = admitReviewReady({
      current: impl,
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
      reviewBaseline: {
        artifactId: "wf-retry.review-baseline",
        fingerprint: "baseline-a",
      },
      verification: {
        passed: true,
        exitCode: 0,
        durationMs: 1,
        attempt: 1,
      },
    });
    saveWorkflowState(storeDir, ready);
    const withRetry = admitReviewRetryState({
      current: ready,
      retry: startRetryAttempt({
        current: undefined,
        operationId: reviewOperationId(
          ready.workflowId,
          logicalReviewId(ready.reviewBaseline.artifactId, 1),
        ),
        operationKind: "review",
        maxAttempts: 2,
      }),
    });
    saveWorkflowState(storeDir, withRetry);
    const loaded = loadWorkflowState(storeDir, "wf-retry");
    assert.equal(loaded.phase, "review_ready");
    if (loaded.phase !== "review_ready") {
      throw new Error("expected review_ready");
    }
    assert.equal(loaded.retry?.attemptsStarted, 1);
    assert.equal(loaded.reviewBaseline.fingerprint, "baseline-a");
    assert.equal(loaded.workspace.workingTreeFingerprint, "fingerprint-b");
    const parsed = parseWorkflowState(JSON.parse(JSON.stringify(loaded)));
    assert.equal(parsed.ok, true);
    assert.equal(parseDurableRetryState(loaded.retry).ok, true);
  });
});

describe("RET01 decision rule", () => {
  it("passes the required retry evidence", () => {
    const assertions = evaluateRetryAssertions(passingRetryArm());
    assert.equal(assertions.sameWorkflowId, true);
    assert.equal(assertions.firstFailureClassifiedTransient, true);
    assert.equal(assertions.retryDecisionFromHarness, true);
    assert.equal(assertions.workerNotRerun, true);
    assert.equal(assertions.preReviewVerifyNotRerun, true);
    assert.equal(Object.values(assertions).every(Boolean), true);
  });

  it("fails if Worker would have been retried blindly", () => {
    const arm = passingRetryArm();
    arm.invocations[2].implementationStarted = true;
    arm.invocations[2].implementationSkipped = false;
    const assertions = evaluateRetryAssertions(arm);
    assert.equal(assertions.workerNotRerun, false);
  });
});

function passingRetryArm(): RetryArmEvidence {
  const retry: DurableRetryState = {
    operationId: "RET01:review:baseline:round-1",
    operationKind: "review",
    attemptsStarted: 1,
    maxAttempts: 2,
    lastFailureClass: "retryable_transient",
  };
  return {
    workflowId: "RET01",
    workspaceId: "ws",
    workspaceRoot: "/tmp/ws",
    baseRevision: "abc",
    reviewReadyFingerprint: "verified-b",
    reviewBaselineArtifactId: "RET01.review-baseline",
    invocations: [
      invocation({
        invocationId: "A",
        pid: 1,
        phaseOnStart: "spec_required",
        phaseOnExit: "review_ready",
        stopAfter: "review_ready",
        workflowStatus: "paused",
        implementationStarted: true,
        implementationSkipped: false,
        preReviewVerifySkipped: false,
        reviewAttempts: 0,
        durableCheckpoint: "review_ready",
        finalReviewerOutcome: "skipped",
      }),
      invocation({
        invocationId: "B",
        pid: 2,
        phaseOnStart: "review_ready",
        phaseOnExit: "review_ready",
        workflowStatus: "paused",
        implementationStarted: false,
        implementationSkipped: true,
        preReviewVerifySkipped: true,
        reviewAttempts: 0,
        retry,
        lastRetryDecision: { action: "retry" },
        finalReviewerOutcome: "skipped",
      }),
      invocation({
        invocationId: "C",
        pid: 3,
        phaseOnStart: "review_ready",
        phaseOnExit: "terminal",
        workflowStatus: "success",
        implementationStarted: false,
        implementationSkipped: true,
        preReviewVerifySkipped: true,
        reviewAttempts: 1,
        retry: null,
        finalReviewerOutcome: "pass",
      }),
    ],
    workerStartedCount: 1,
    workerSkippedCount: 2,
    preReviewVerifySkippedCount: 2,
    reviewStartedCount: 2,
    injectedFailureCount: 1,
    classifiedTransientCount: 1,
    harnessRetryDecisionCount: 1,
    reviewCompletedPassCount: 1,
    terminalPhase: "terminal",
  };
}

function invocation(
  overrides: Partial<RetryInvocationEvidence>,
): RetryInvocationEvidence {
  return {
    workflowId: "RET01",
    invocationId: "X",
    pid: 0,
    ppid: 0,
    phaseOnStart: "review_ready",
    phaseOnExit: "review_ready",
    stopAfter: null,
    workflowStatus: "paused",
    specDecision: "executable",
    implementationStarted: false,
    specModelCalls: 0,
    specToolCalls: 0,
    durableCheckpoint: null,
    implementationSkipped: true,
    preReviewVerifySkipped: true,
    reviewBaselineRestored: true,
    reviewAttempts: 0,
    tracePath: "",
    finalVerificationPassed: true,
    finalReviewerOutcome: "skipped",
    workspaceId: "ws",
    workspaceRoot: "/tmp/ws",
    baseRevision: "abc",
    retry: null,
    lastRetryDecision: null,
    changedFiles: ["tasks/task-service.ts"],
    diffFingerprint: "aaaaaaaaaaaaaaaa",
    ...overrides,
  };
}
