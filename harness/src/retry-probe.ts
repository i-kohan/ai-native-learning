import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, REPO_ROOT, type HarnessConfig } from "./config.ts";
import { invocationEvidencePath } from "./run-durable-invocation.ts";
import type { DurableRetryState, RetryDecision } from "./retry.ts";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  captureWorkspaceResumeEvidence,
} from "./workspace.ts";
import { initializeWorkflow, loadWorkflowState } from "./workflow-store.ts";
import type { DurableCheckpoint, ReviewReadyState } from "./workflow-state.ts";

export const RETRY_PROBE_ID = "RET01";
export const RETRY_TASK_ID = "T02";

export type RetryInvocationEvidence = {
  workflowId: string;
  invocationId: string;
  pid: number;
  ppid: number;
  phaseOnStart: string;
  phaseOnExit: string;
  stopAfter: DurableCheckpoint | null;
  workflowStatus: string;
  specDecision: string | null;
  implementationStarted: boolean;
  specModelCalls: number;
  specToolCalls: number;
  durableCheckpoint: string | null;
  implementationSkipped: boolean;
  preReviewVerifySkipped: boolean;
  reviewBaselineRestored: boolean;
  reviewAttempts: number;
  tracePath: string;
  finalVerificationPassed: boolean;
  finalReviewerOutcome: string;
  workspaceId: string | null;
  workspaceRoot: string | null;
  baseRevision: string | null;
  retry: DurableRetryState | null;
  lastRetryDecision: RetryDecision | null;
  changedFiles: string[];
  diffFingerprint: string;
};

export type RetryArmEvidence = {
  workflowId: string;
  workspaceId: string;
  workspaceRoot: string;
  baseRevision: string;
  reviewReadyFingerprint: string | null;
  reviewBaselineArtifactId: string | null;
  invocations: RetryInvocationEvidence[];
  workerStartedCount: number;
  workerSkippedCount: number;
  preReviewVerifySkippedCount: number;
  reviewStartedCount: number;
  injectedFailureCount: number;
  classifiedTransientCount: number;
  harnessRetryDecisionCount: number;
  reviewCompletedPassCount: number;
  terminalPhase: string | null;
};

export type RetryProbeResult = {
  taskId: typeof RETRY_PROBE_ID;
  taskKind: "mechanism_probe";
  mechanism: "retry_semantics";
  task: typeof RETRY_TASK_ID;
  passed: boolean;
  arm: RetryArmEvidence;
  assertions: Record<string, boolean>;
  evidencePath: string;
};

const DECISION_RULE = [
  "RET01 passes only if all are true:",
  "1. A, B, and C share one workflow identity.",
  "2. A persists the authoritative review_ready checkpoint/artifact.",
  "3. B and C resume that same review_ready artifact.",
  "4. B starts REVIEW attempt 1.",
  "5. B's first failure is classified retryable_transient by the harness.",
  "6. retry admission comes from harness RetryPolicy, not the model.",
  "7. attemptsStarted is persisted before the next attempt and the budget is respected.",
  "8. C starts REVIEW attempt 2 in a fresh process.",
  "9. Worker is not rerun in B or C.",
  "10. pre-review VERIFY is not rerun in B or C.",
  "11. independent REVIEW still runs and a successful REVIEW result is required.",
  "12. final workflow state is terminal.",
].join("\n");

export async function runRetryProbe(options: {
  prepare: (config: HarnessConfig) => {
    task: string;
    initialTestsPassed: boolean;
  };
}): Promise<RetryProbeResult> {
  const stamp = timestamp();
  const storeDir = path.join(
    REPO_ROOT,
    "traces",
    "workflows",
    `RET01-${stamp}`,
  );
  fs.mkdirSync(storeDir, { recursive: true });

  const arm = await runArm({
    storeDir,
    workflowId: `RET01-${stamp}`,
    prepare: options.prepare,
  });
  const assertions = evaluateRetryAssertions(arm);
  const passed = Object.values(assertions).every(Boolean);
  const result: RetryProbeResult = {
    taskId: RETRY_PROBE_ID,
    taskKind: "mechanism_probe",
    mechanism: "retry_semantics",
    task: RETRY_TASK_ID,
    passed,
    arm,
    assertions,
    evidencePath: "",
  };
  result.evidencePath = writeRetryEvidence(storeDir, result);
  return result;
}

export function evaluateRetryAssertions(
  arm: RetryArmEvidence,
): Record<string, boolean> {
  const processA = arm.invocations[0];
  const processB = arm.invocations[1];
  const processC = arm.invocations[2];
  const hasBTrace = Boolean(
    processB?.tracePath && fs.existsSync(processB.tracePath),
  );
  const hasCTrace = Boolean(
    processC?.tracePath && fs.existsSync(processC.tracePath),
  );
  const bTrace = inspectTrace(processB?.tracePath ?? "");
  const cTrace = inspectTrace(processC?.tracePath ?? "");
  const bState = processB?.retry;
  const sameWorkflow =
    Boolean(processA && processB && processC) &&
    processA.workflowId === arm.workflowId &&
    processB.workflowId === arm.workflowId &&
    processC.workflowId === arm.workflowId;
  return {
    sameWorkflowId: sameWorkflow,
    sameReviewReadyArtifact:
      processA?.phaseOnExit === "review_ready" &&
      processA.durableCheckpoint === "review_ready" &&
      processB?.phaseOnStart === "review_ready" &&
      processC?.phaseOnStart === "review_ready" &&
      processA.workspaceId === arm.workspaceId &&
      processB.workspaceId === arm.workspaceId &&
      processC.workspaceId === arm.workspaceId &&
      Boolean(arm.reviewReadyFingerprint) &&
      Boolean(arm.reviewBaselineArtifactId),
    firstReviewAttemptHappened:
      bState?.attemptsStarted === 1 &&
      (!hasBTrace ||
        (bTrace.reviewRetryAttemptsStarted.includes(1) &&
          (bTrace.reviewStarted >= 1 || bTrace.injectedFailureCount >= 1))),
    firstFailureClassifiedTransient:
      bState?.lastFailureClass === "retryable_transient" &&
      (!hasBTrace || bTrace.classifiedTransientCount >= 1),
    retryDecisionFromHarness:
      processB?.lastRetryDecision?.action === "retry" &&
      (!hasBTrace ||
        (bTrace.harnessRetryDecisionCount >= 1 &&
          bTrace.retryDecisionSource === "harness_retry_policy")),
    retryBudgetRespected:
      bState?.attemptsStarted === 1 &&
      bState.maxAttempts === 2 &&
      bState.attemptsStarted < bState.maxAttempts &&
      (processC.retry === null || processC.phaseOnExit === "terminal"),
    attemptsStartedAdvancedDurably:
      bState?.attemptsStarted === 1 &&
      (!hasCTrace ||
        (cTrace.reviewRetryAttemptsStarted.includes(2) &&
          cTrace.durableAttemptsStarted.includes(2))),
    secondReviewAttemptHappened:
      Boolean(processB && processC) &&
      processB.pid !== processC.pid &&
      processB.invocationId !== processC.invocationId &&
      processC.reviewAttempts > 0 &&
      (!hasCTrace ||
        (cTrace.reviewRetryAttemptsStarted.includes(2) &&
          cTrace.reviewStarted >= 1)),
    workerNotRerun:
      processB?.implementationStarted === false &&
      processC?.implementationStarted === false &&
      processB?.implementationSkipped === true &&
      processC?.implementationSkipped === true &&
      arm.workerStartedCount <= 1 &&
      (!hasBTrace || bTrace.workerStarted === 0) &&
      (!hasCTrace || cTrace.workerStarted === 0),
    preReviewVerifyNotRerun:
      processB?.preReviewVerifySkipped === true &&
      processC?.preReviewVerifySkipped === true &&
      (!hasBTrace || bTrace.verifyBeforeReview.length === 0) &&
      (!hasCTrace || cTrace.verifyBeforeReview.length === 0),
    independentReviewNotBypassed:
      processC?.finalReviewerOutcome === "pass" &&
      processC.reviewAttempts > 0 &&
      (!hasCTrace ||
        (cTrace.reviewStarted >= 1 && cTrace.injectedFailureCount === 0)),
    successfulReviewRequired:
      processC?.reviewAttempts > 0 &&
      processC.workflowStatus === "success" &&
      processC.finalReviewerOutcome === "pass" &&
      (!hasCTrace || arm.reviewCompletedPassCount >= 1),
    terminalPersisted:
      processC?.phaseOnExit === "terminal" && arm.terminalPhase === "terminal",
  };
}

export function isExpectedRET01Outcome(result: RetryProbeResult): boolean {
  return result.passed;
}

export function printRetryProbeSummary(result: RetryProbeResult): void {
  console.log("\n=== RET01 Retry Semantics Probe ===");
  console.log(DECISION_RULE);
  console.log(`passed: ${result.passed ? "yes" : "no"}`);
  console.log(`workflow: ${result.arm.workflowId}`);
  for (const [key, value] of Object.entries(result.assertions)) {
    console.log(`  ${key}: ${value ? "yes" : "NO"}`);
  }
  console.log(`evidence: ${result.evidencePath}`);
}

async function runArm(options: {
  storeDir: string;
  workflowId: string;
  prepare: (config: HarnessConfig) => {
    task: string;
    initialTestsPassed: boolean;
  };
}): Promise<RetryArmEvidence> {
  const workspace = createWorkspace({
    hostRepoRoot: REPO_ROOT,
    id: options.workflowId,
  });
  try {
    const hostConfig = loadConfig();
    const config = bindConfig(hostConfig, workspace);
    const prep = options.prepare(config);
    if (prep.initialTestsPassed) {
      throw new Error("T02: expected initial tests to FAIL after setup.");
    }
    const evidence = captureWorkspaceResumeEvidence(workspace);
    initializeWorkflow({
      storeDir: options.storeDir,
      workflowId: options.workflowId,
      task: prep.task,
      workspace: evidence,
    });

    const processA = runInvocation({
      storeDir: options.storeDir,
      workflowId: options.workflowId,
      runId: `${options.workflowId}-A`,
      stopAfter: "review_ready",
    });
    const reviewReady = loadReviewReady(
      options.storeDir,
      options.workflowId,
      "after process A",
    );
    const processB = runInvocation({
      storeDir: options.storeDir,
      workflowId: options.workflowId,
      runId: `${options.workflowId}-B`,
      injectReviewTransientFailureOnAttempt: 1,
      stopAfterRetryAdmission: true,
    });
    loadReviewReady(options.storeDir, options.workflowId, "after process B");
    const processC = runInvocation({
      storeDir: options.storeDir,
      workflowId: options.workflowId,
      runId: `${options.workflowId}-C`,
    });
    const finalState = loadWorkflowState(options.storeDir, options.workflowId);
    const traces = [processA, processB, processC].map((item) =>
      inspectTrace(item.tracePath),
    );

    return {
      workflowId: options.workflowId,
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      baseRevision: workspace.baseRevision,
      reviewReadyFingerprint: reviewReady.workspace.workingTreeFingerprint,
      reviewBaselineArtifactId: reviewReady.reviewBaseline.artifactId,
      invocations: [processA, processB, processC],
      workerStartedCount: traces.reduce(
        (sum, item) => sum + item.workerStarted,
        0,
      ),
      workerSkippedCount: traces.reduce(
        (sum, item) => sum + item.workerSkipped,
        0,
      ),
      preReviewVerifySkippedCount: traces.reduce(
        (sum, item) => sum + item.preReviewVerifySkipped,
        0,
      ),
      reviewStartedCount: traces.reduce(
        (sum, item) => sum + item.reviewStarted,
        0,
      ),
      injectedFailureCount: traces.reduce(
        (sum, item) => sum + item.injectedFailureCount,
        0,
      ),
      classifiedTransientCount: traces.reduce(
        (sum, item) => sum + item.classifiedTransientCount,
        0,
      ),
      harnessRetryDecisionCount: traces.reduce(
        (sum, item) => sum + item.harnessRetryDecisionCount,
        0,
      ),
      reviewCompletedPassCount: traces.reduce(
        (sum, item) => sum + item.reviewCompletedPassCount,
        0,
      ),
      terminalPhase: finalState.phase,
    };
  } finally {
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
  }
}

function loadReviewReady(
  storeDir: string,
  workflowId: string,
  label: string,
): ReviewReadyState {
  const state = loadWorkflowState(storeDir, workflowId);
  if (state.phase !== "review_ready") {
    throw new Error(`Expected review_ready ${label}, got ${state.phase}`);
  }
  return state;
}

function runInvocation(options: {
  storeDir: string;
  workflowId: string;
  runId: string;
  stopAfter?: DurableCheckpoint;
  injectReviewTransientFailureOnAttempt?: number;
  stopAfterRetryAdmission?: boolean;
}): RetryInvocationEvidence {
  const harnessDir = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(harnessDir, "run-durable-invocation.ts");
  const tsxCli = path.join(harnessDir, "../node_modules/tsx/dist/cli.mjs");
  const args = [
    tsxCli,
    script,
    "--workflow-id",
    options.workflowId,
    "--store-dir",
    options.storeDir,
    "--run-id",
    options.runId,
  ];
  if (options.stopAfter) {
    args.push("--stop-after", options.stopAfter);
  }
  if (options.injectReviewTransientFailureOnAttempt) {
    args.push(
      "--inject-review-transient-failure-on-attempt",
      String(options.injectReviewTransientFailureOnAttempt),
    );
  }
  if (options.stopAfterRetryAdmission) {
    args.push("--stop-after-retry-admission");
  }
  const spawned = spawnSync(process.execPath, args, {
    cwd: path.join(REPO_ROOT, "harness"),
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  const allowNonZero = Boolean(
    options.stopAfter || options.stopAfterRetryAdmission,
  );
  if (spawned.status !== 0 && !allowNonZero) {
    throw new Error(
      `Retry invocation ${options.runId} failed:\n${spawned.stdout}\n${spawned.stderr}`,
    );
  }
  const evidenceFile = invocationEvidencePath(options.storeDir, options.runId);
  if (!fs.existsSync(evidenceFile)) {
    throw new Error(
      `Missing invocation evidence for ${options.runId}:\n${spawned.stdout}\n${spawned.stderr}`,
    );
  }
  return JSON.parse(
    fs.readFileSync(evidenceFile, "utf8"),
  ) as RetryInvocationEvidence;
}

function inspectTrace(tracePath: string): {
  workerStarted: number;
  workerSkipped: number;
  preReviewVerifySkipped: number;
  verifyBeforeReview: string[];
  reviewStarted: number;
  injectedFailureCount: number;
  classifiedTransientCount: number;
  harnessRetryDecisionCount: number;
  retryDecisionSource: string | null;
  reviewRetryAttemptsStarted: number[];
  durableAttemptsStarted: number[];
  reviewCompletedPassCount: number;
} {
  const empty = {
    workerStarted: 0,
    workerSkipped: 0,
    preReviewVerifySkipped: 0,
    verifyBeforeReview: [] as string[],
    reviewStarted: 0,
    injectedFailureCount: 0,
    classifiedTransientCount: 0,
    harnessRetryDecisionCount: 0,
    retryDecisionSource: null as string | null,
    reviewRetryAttemptsStarted: [] as number[],
    durableAttemptsStarted: [] as number[],
    reviewCompletedPassCount: 0,
  };
  if (!tracePath || !fs.existsSync(tracePath)) {
    return empty;
  }
  const events = fs
    .readFileSync(tracePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const firstReviewIndex = events.findIndex(
    (item) => item.event === "review_started",
  );
  const retryDecisions = events.filter(
    (item) => item.event === "review_retry_decision",
  );
  return {
    workerStarted: events.filter(
      (item) => item.event === "implementation_started",
    ).length,
    workerSkipped: events.filter(
      (item) => item.event === "implementation_skipped",
    ).length,
    preReviewVerifySkipped: events.filter(
      (item) => item.event === "pre_review_verify_skipped",
    ).length,
    verifyBeforeReview: events
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.event === "verification_attempt")
      .filter(({ index }) => firstReviewIndex < 0 || index < firstReviewIndex)
      .map(({ item }) => (item.passed ? "PASS" : "FAIL")),
    reviewStarted: events.filter((item) => item.event === "review_started")
      .length,
    injectedFailureCount: events.filter(
      (item) => item.event === "review_retry_injected_failure",
    ).length,
    classifiedTransientCount: events.filter(
      (item) =>
        item.event === "review_retry_classified" &&
        item.failureClass === "retryable_transient" &&
        item.source === "harness",
    ).length,
    harnessRetryDecisionCount: retryDecisions.filter(
      (item) =>
        item.action === "retry" && item.source === "harness_retry_policy",
    ).length,
    retryDecisionSource:
      typeof retryDecisions[0]?.source === "string"
        ? retryDecisions[0].source
        : null,
    reviewRetryAttemptsStarted: events
      .filter((item) => item.event === "review_retry_attempt_started")
      .map((item) =>
        typeof item.attemptsStarted === "number" ? item.attemptsStarted : 0,
      )
      .filter((value) => value > 0),
    durableAttemptsStarted: events
      .filter(
        (item) => item.event === "durable_retry_state" && item.cleared !== true,
      )
      .map((item) =>
        typeof item.attemptsStarted === "number" ? item.attemptsStarted : 0,
      )
      .filter((value) => value > 0),
    reviewCompletedPassCount: events.filter(
      (item) => item.event === "review_completed" && item.status === "pass",
    ).length,
  };
}

function writeRetryEvidence(
  storeDir: string,
  result: RetryProbeResult,
): string {
  const stamp = timestamp();
  const tracesDir = path.join(REPO_ROOT, "traces");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/18-retry-semantics/traces",
  );
  fs.mkdirSync(tracesDir, { recursive: true });
  fs.mkdirSync(lessonDir, { recursive: true });
  const payload = `${JSON.stringify({ ...result, decisionRule: DECISION_RULE }, null, 2)}\n`;
  const report = `${formatRetryReport(result)}\n`;
  const jsonName = `RET01-retry-${stamp}.json`;
  const reportName = `RET01-retry-${stamp}.txt`;
  const hostPath = path.join(tracesDir, jsonName);
  fs.writeFileSync(hostPath, payload);
  fs.writeFileSync(path.join(tracesDir, reportName), report);
  fs.writeFileSync(path.join(storeDir, jsonName), payload);
  fs.writeFileSync(path.join(storeDir, reportName), report);
  fs.writeFileSync(path.join(lessonDir, jsonName), payload);
  fs.writeFileSync(path.join(lessonDir, reportName), report);
  for (const invocation of result.arm.invocations) {
    copyIfExists(invocation.tracePath, lessonDir);
    copyIfExists(
      invocation.tracePath.replace(/\.jsonl$/, ".spec.json"),
      lessonDir,
    );
    copyIfExists(
      invocationEvidencePath(storeDir, invocation.invocationId),
      lessonDir,
    );
  }
  return hostPath;
}

function formatRetryReport(result: RetryProbeResult): string {
  return [
    "=== RET01 Retry Semantics Probe ===",
    DECISION_RULE,
    "",
    `passed: ${result.passed ? "yes" : "no"}`,
    `workflowId: ${result.arm.workflowId}`,
    `workspace: ${result.arm.workspaceId} @ ${result.arm.baseRevision.slice(0, 12)}`,
    `review_ready_fingerprint: ${result.arm.reviewReadyFingerprint ?? "(none)"}`,
    `worker_started: ${result.arm.workerStartedCount}`,
    `worker_skipped: ${result.arm.workerSkippedCount}`,
    `pre_review_verify_skipped: ${result.arm.preReviewVerifySkippedCount}`,
    `review_started: ${result.arm.reviewStartedCount}`,
    `injected_failure: ${result.arm.injectedFailureCount}`,
    `classified_transient: ${result.arm.classifiedTransientCount}`,
    `harness_retry_decisions: ${result.arm.harnessRetryDecisionCount}`,
    `review_pass: ${result.arm.reviewCompletedPassCount}`,
    `terminal_phase: ${result.arm.terminalPhase ?? "(none)"}`,
    ...result.arm.invocations.map(
      (item) =>
        `  ${item.invocationId} pid=${item.pid} start=${item.phaseOnStart} exit=${item.phaseOnExit} skippedWorker=${item.implementationSkipped ? "yes" : "no"} skippedVerify=${item.preReviewVerifySkipped ? "yes" : "no"} reviews=${item.reviewAttempts} retryAttempts=${item.retry?.attemptsStarted ?? 0} lastClass=${item.retry?.lastFailureClass ?? "(none)"} decision=${item.lastRetryDecision?.action ?? "(none)"} status=${item.workflowStatus}`,
    ),
    "",
    "Assertions",
    ...Object.entries(result.assertions).map(
      ([key, value]) => `- ${key}: ${value ? "yes" : "NO"}`,
    ),
  ].join("\n");
}

function copyIfExists(from: string, lessonDir: string): void {
  if (!fs.existsSync(from)) {
    return;
  }
  fs.copyFileSync(from, path.join(lessonDir, path.basename(from)));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
