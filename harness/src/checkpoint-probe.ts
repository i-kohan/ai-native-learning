import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, REPO_ROOT, type HarnessConfig } from "./config.ts";
import { invocationEvidencePath } from "./run-durable-invocation.ts";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  captureWorkspaceResumeEvidence,
} from "./workspace.ts";
import { initializeWorkflow, loadWorkflowState } from "./workflow-store.ts";
import type { DurableCheckpoint } from "./workflow-state.ts";

export const CHECKPOINT_PROBE_ID = "CHK01";
export const CHECKPOINT_TASK_ID = "T02";

export type CheckpointInvocationEvidence = {
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
};

export type CheckpointArmEvidence = {
  workflowId: string;
  workspaceId: string;
  workspaceRoot: string;
  baseRevision: string;
  workingTreeFingerprint: string;
  invocations: CheckpointInvocationEvidence[];
  specPhaseStartedCount: number;
  specPhaseSkippedCount: number;
  workerStartedCount: number;
  workerSkippedCount: number;
  preReviewVerifySkippedCount: number;
  verifyBeforeReview: string[];
  processBVerifyBeforeReview: string[];
  verifyAfterReview: string[];
  reviewOutcomes: string[];
  reviewStartedCount: number;
  reviewBaselineRestoredCount: number;
  reviewVerificationPassedCount: number;
  terminalPhase: string | null;
  expectedOutcomeMet: boolean;
};

export type CheckpointProbeResult = {
  taskId: typeof CHECKPOINT_PROBE_ID;
  taskKind: "mechanism_probe";
  mechanism: "checkpoint_resume";
  task: typeof CHECKPOINT_TASK_ID;
  passed: boolean;
  control: CheckpointArmEvidence;
  interrupted: CheckpointArmEvidence;
  assertions: Record<string, boolean>;
  evidencePath: string;
};

const DECISION_RULE = [
  "CHK01 passes only if all are true:",
  "1. control succeeds end-to-end.",
  "2. interrupted A/B use the same workflow ID.",
  "3. A and B are separate process/invocation executions.",
  "4. A durably persists review_ready.",
  "5. B loads/resumes from review_ready.",
  "6. B validates the exact verified workspace artifact.",
  "7. B reconstructs the intended review baseline/diff.",
  "8. Worker is not rerun in B.",
  "9. pre-review VERIFY is not rerun in B merely for reconstruction.",
  "10. independent REVIEW runs in B.",
  "11. REVIEW receives verification evidence for the accepted artifact.",
  "12. expected T02 task behavior remains correct.",
  "13. terminal state is durably persisted.",
  "14. control and interrupted paths preserve the intended semantic outcome.",
].join("\n");

export async function runCheckpointProbe(options: {
  prepare: (config: HarnessConfig) => {
    task: string;
    initialTestsPassed: boolean;
  };
}): Promise<CheckpointProbeResult> {
  const stamp = timestamp();
  const storeDir = path.join(
    REPO_ROOT,
    "traces",
    "workflows",
    `CHK01-${stamp}`,
  );
  fs.mkdirSync(storeDir, { recursive: true });

  const control = await runArm({
    storeDir,
    workflowId: `CHK01-control-${stamp}`,
    interrupt: false,
    prepare: options.prepare,
  });
  const interrupted = await runArm({
    storeDir,
    workflowId: `CHK01-interrupted-${stamp}`,
    interrupt: true,
    prepare: options.prepare,
  });

  const assertions = evaluateCheckpointAssertions(control, interrupted);
  const passed = Object.values(assertions).every(Boolean);
  const result: CheckpointProbeResult = {
    taskId: CHECKPOINT_PROBE_ID,
    taskKind: "mechanism_probe",
    mechanism: "checkpoint_resume",
    task: CHECKPOINT_TASK_ID,
    passed,
    control,
    interrupted,
    assertions,
    evidencePath: "",
  };
  result.evidencePath = writeCheckpointEvidence(storeDir, result);
  return result;
}

export function evaluateCheckpointAssertions(
  control: CheckpointArmEvidence,
  interrupted: CheckpointArmEvidence,
): Record<string, boolean> {
  const processA = interrupted.invocations[0];
  const processB = interrupted.invocations[1];
  const hasBTrace = Boolean(
    processB?.tracePath && fs.existsSync(processB.tracePath),
  );
  const bTrace = inspectTrace(processB?.tracePath ?? "");
  return {
    controlExpected: control.expectedOutcomeMet,
    controlTerminalPersisted: control.terminalPhase === "terminal",
    sameWorkflowId:
      processA?.workflowId === interrupted.workflowId &&
      processB?.workflowId === interrupted.workflowId,
    processBFresh:
      Boolean(processA && processB) &&
      processA.pid !== processB.pid &&
      processA.invocationId !== processB.invocationId,
    processAPersistedReviewReady:
      processA?.phaseOnExit === "review_ready" &&
      processA.durableCheckpoint === "review_ready",
    processBResumedFromReviewReady:
      processB?.phaseOnStart === "review_ready" &&
      interrupted.terminalPhase === "terminal",
    processBValidatedWorkspace:
      processA?.workspaceId === interrupted.workspaceId &&
      processB?.workspaceId === interrupted.workspaceId &&
      processA?.workspaceRoot === interrupted.workspaceRoot &&
      processB?.workspaceRoot === interrupted.workspaceRoot &&
      processA?.baseRevision === interrupted.baseRevision &&
      processB?.baseRevision === interrupted.baseRevision &&
      (!hasBTrace || bTrace.workspaceValidated),
    processBReconstructedBaseline:
      processB?.reviewBaselineRestored === true &&
      interrupted.reviewBaselineRestoredCount >= 1 &&
      (!hasBTrace || bTrace.reconstructedChangedFiles > 0),
    processBDidNotRerunWorker:
      processB?.implementationStarted === false &&
      processB?.implementationSkipped === true &&
      interrupted.workerSkippedCount >= 1 &&
      (!hasBTrace || bTrace.workerStarted === 0),
    processBDidNotRerunPreReviewVerify:
      processB?.preReviewVerifySkipped === true &&
      interrupted.preReviewVerifySkippedCount >= 1 &&
      interrupted.processBVerifyBeforeReview.length === 0 &&
      (!hasBTrace || bTrace.verifyBeforeReview.length === 0),
    processBRanIndependentReview:
      Boolean(processB && processB.reviewAttempts > 0) &&
      interrupted.reviewOutcomes.includes("pass"),
    processBReviewHadVerificationEvidence:
      interrupted.reviewVerificationPassedCount >= 1 &&
      (!hasBTrace ||
        (bTrace.reviewVerificationPassed &&
          bTrace.promptIncludesVerificationEvidence)),
    interruptedExpected: interrupted.expectedOutcomeMet,
    interruptedTerminalPersisted: interrupted.terminalPhase === "terminal",
    semanticOutcomePreserved:
      control.expectedOutcomeMet && interrupted.expectedOutcomeMet,
    distinctFromControlWorkflow: control.workflowId !== interrupted.workflowId,
  };
}

export function isExpectedCheckpointArmOutcome(
  last: CheckpointInvocationEvidence,
  traces: Array<{ reviewOutcomes: string[] }>,
): boolean {
  return (
    last.workflowStatus === "success" &&
    last.specDecision === "executable" &&
    last.finalVerificationPassed &&
    last.finalReviewerOutcome === "pass" &&
    traces.some((item) => item.reviewOutcomes.includes("pass"))
  );
}

export function isExpectedCHK01Outcome(result: CheckpointProbeResult): boolean {
  return result.passed;
}

export function printCheckpointProbeSummary(
  result: CheckpointProbeResult,
): void {
  console.log("\n=== CHK01 Checkpoint / Resume Probe ===");
  console.log(DECISION_RULE);
  console.log(`passed: ${result.passed ? "yes" : "no"}`);
  console.log(`control_workflow: ${result.control.workflowId}`);
  console.log(`interrupted_workflow: ${result.interrupted.workflowId}`);
  for (const [key, value] of Object.entries(result.assertions)) {
    console.log(`  ${key}: ${value ? "yes" : "NO"}`);
  }
  console.log(`evidence: ${result.evidencePath}`);
}

async function runArm(options: {
  storeDir: string;
  workflowId: string;
  interrupt: boolean;
  prepare: (config: HarnessConfig) => {
    task: string;
    initialTestsPassed: boolean;
  };
}): Promise<CheckpointArmEvidence> {
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

    const invocations: CheckpointInvocationEvidence[] = [];
    if (options.interrupt) {
      runInvocation({
        storeDir: options.storeDir,
        workflowId: options.workflowId,
        runId: `${options.workflowId}-seed`,
        stopAfter: "implementation_ready",
      });
      invocations.push(
        runInvocation({
          storeDir: options.storeDir,
          workflowId: options.workflowId,
          runId: `${options.workflowId}-A`,
          stopAfter: "review_ready",
        }),
      );
      invocations.push(
        runInvocation({
          storeDir: options.storeDir,
          workflowId: options.workflowId,
          runId: `${options.workflowId}-B`,
        }),
      );
    } else {
      invocations.push(
        runInvocation({
          storeDir: options.storeDir,
          workflowId: options.workflowId,
          runId: `${options.workflowId}-control`,
        }),
      );
    }

    const finalState = loadWorkflowState(options.storeDir, options.workflowId);
    const traces = invocations.map((item) => inspectTrace(item.tracePath));
    const last = invocations[invocations.length - 1];
    const expectedOutcomeMet = isExpectedCheckpointArmOutcome(last, traces);

    return {
      workflowId: options.workflowId,
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      baseRevision: workspace.baseRevision,
      workingTreeFingerprint: evidence.workingTreeFingerprint,
      invocations,
      specPhaseStartedCount: traces.reduce(
        (sum, item) => sum + item.specPhaseStarted,
        0,
      ),
      specPhaseSkippedCount: traces.reduce(
        (sum, item) => sum + item.specPhaseSkipped,
        0,
      ),
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
      verifyBeforeReview: traces.flatMap((item) => item.verifyBeforeReview),
      processBVerifyBeforeReview:
        traces[traces.length - 1]?.verifyBeforeReview ?? [],
      verifyAfterReview: traces.flatMap((item) => item.verifyAfterReview),
      reviewOutcomes: traces.flatMap((item) => item.reviewOutcomes),
      reviewStartedCount: traces.reduce(
        (sum, item) => sum + item.reviewStarted,
        0,
      ),
      reviewBaselineRestoredCount: traces.reduce(
        (sum, item) => sum + item.reviewBaselineRestored,
        0,
      ),
      reviewVerificationPassedCount: traces.reduce(
        (sum, item) => sum + (item.reviewVerificationPassed ? 1 : 0),
        0,
      ),
      terminalPhase: finalState.phase,
      expectedOutcomeMet,
    };
  } finally {
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
  }
}

function runInvocation(options: {
  storeDir: string;
  workflowId: string;
  runId: string;
  stopAfter?: DurableCheckpoint;
}): CheckpointInvocationEvidence {
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
  const spawned = spawnSync(process.execPath, args, {
    cwd: path.join(REPO_ROOT, "harness"),
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (spawned.status !== 0 && !options.stopAfter) {
    throw new Error(
      `Checkpoint invocation ${options.runId} failed:\n${spawned.stdout}\n${spawned.stderr}`,
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
  ) as CheckpointInvocationEvidence;
}

function inspectTrace(tracePath: string): {
  specPhaseStarted: number;
  specPhaseSkipped: number;
  workerStarted: number;
  workerSkipped: number;
  preReviewVerifySkipped: number;
  verifyBeforeReview: string[];
  verifyAfterReview: string[];
  reviewOutcomes: string[];
  reviewStarted: number;
  reviewBaselineRestored: number;
  reviewVerificationPassed: boolean;
  promptIncludesVerificationEvidence: boolean;
  workspaceValidated: boolean;
  reconstructedChangedFiles: number;
} {
  const empty = {
    specPhaseStarted: 0,
    specPhaseSkipped: 0,
    workerStarted: 0,
    workerSkipped: 0,
    preReviewVerifySkipped: 0,
    verifyBeforeReview: [] as string[],
    verifyAfterReview: [] as string[],
    reviewOutcomes: [] as string[],
    reviewStarted: 0,
    reviewBaselineRestored: 0,
    reviewVerificationPassed: false,
    promptIncludesVerificationEvidence: false,
    workspaceValidated: false,
    reconstructedChangedFiles: 0,
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
  const verifyEvents = events
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.event === "verification_attempt");
  const reconstructed = events.find(
    (item) => item.event === "review_input_reconstructed",
  );
  const resumed = events.find((item) => item.event === "review_ready_resumed");
  const reviewStarted = events.find((item) => item.event === "review_started");
  return {
    specPhaseStarted: events.filter(
      (item) => item.event === "spec_phase_started",
    ).length,
    specPhaseSkipped: events.filter(
      (item) => item.event === "spec_phase_skipped",
    ).length,
    workerStarted: events.filter(
      (item) => item.event === "implementation_started",
    ).length,
    workerSkipped: events.filter(
      (item) => item.event === "implementation_skipped",
    ).length,
    preReviewVerifySkipped: events.filter(
      (item) => item.event === "pre_review_verify_skipped",
    ).length,
    verifyBeforeReview: verifyEvents
      .filter(({ index }) => firstReviewIndex < 0 || index < firstReviewIndex)
      .map(({ item }) => (item.passed ? "PASS" : "FAIL")),
    verifyAfterReview: verifyEvents
      .filter(({ index }) => firstReviewIndex >= 0 && index > firstReviewIndex)
      .map(({ item }) => (item.passed ? "PASS" : "FAIL")),
    reviewOutcomes: events
      .filter((item) => item.event === "review_completed")
      .map((item) => String(item.status ?? "unknown")),
    reviewStarted: events.filter((item) => item.event === "review_started")
      .length,
    reviewBaselineRestored: events.filter(
      (item) =>
        item.event === "review_ready_resumed" && item.reviewBaselineRestored,
    ).length,
    reviewVerificationPassed:
      reviewStarted?.verificationPassed === true ||
      (isRecord(resumed?.verification) && resumed.verification.passed === true),
    promptIncludesVerificationEvidence:
      reviewStarted?.promptIncludesVerificationEvidence === true,
    workspaceValidated: resumed?.workspaceValidated === true,
    reconstructedChangedFiles: Array.isArray(reconstructed?.changedFiles)
      ? reconstructed.changedFiles.length
      : 0,
  };
}

function writeCheckpointEvidence(
  storeDir: string,
  result: CheckpointProbeResult,
): string {
  const stamp = timestamp();
  const tracesDir = path.join(REPO_ROOT, "traces");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/17-checkpoint-resume/traces",
  );
  fs.mkdirSync(tracesDir, { recursive: true });
  fs.mkdirSync(lessonDir, { recursive: true });
  const payload = `${JSON.stringify({ ...result, decisionRule: DECISION_RULE }, null, 2)}\n`;
  const report = `${formatCheckpointReport(result)}\n`;
  const jsonName = `CHK01-checkpoint-${stamp}.json`;
  const reportName = `CHK01-checkpoint-${stamp}.txt`;
  const hostPath = path.join(tracesDir, jsonName);
  fs.writeFileSync(hostPath, payload);
  fs.writeFileSync(path.join(tracesDir, reportName), report);
  fs.writeFileSync(path.join(storeDir, jsonName), payload);
  fs.writeFileSync(path.join(storeDir, reportName), report);
  fs.writeFileSync(path.join(lessonDir, jsonName), payload);
  fs.writeFileSync(path.join(lessonDir, reportName), report);
  for (const arm of [result.control, result.interrupted]) {
    for (const invocation of arm.invocations) {
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
  }
  return hostPath;
}

function formatCheckpointReport(result: CheckpointProbeResult): string {
  return [
    "=== CHK01 Checkpoint / Resume Probe ===",
    DECISION_RULE,
    "",
    `passed: ${result.passed ? "yes" : "no"}`,
    "",
    "Control (uninterrupted)",
    formatArm(result.control),
    "",
    "Interrupted / resumed",
    formatArm(result.interrupted),
    "",
    "Assertions",
    ...Object.entries(result.assertions).map(
      ([key, value]) => `- ${key}: ${value ? "yes" : "NO"}`,
    ),
  ].join("\n");
}

function formatArm(arm: CheckpointArmEvidence): string {
  return [
    `workflowId: ${arm.workflowId}`,
    `workspace: ${arm.workspaceId} @ ${arm.baseRevision.slice(0, 12)}`,
    `spec_phase_started: ${arm.specPhaseStartedCount}`,
    `spec_phase_skipped: ${arm.specPhaseSkippedCount}`,
    `worker_started: ${arm.workerStartedCount}`,
    `worker_skipped: ${arm.workerSkippedCount}`,
    `pre_review_verify_skipped: ${arm.preReviewVerifySkippedCount}`,
    `verify_before_review: ${arm.verifyBeforeReview.join("→") || "(none)"}`,
    `verify_before_review_B: ${arm.processBVerifyBeforeReview.join("→") || "(none)"}`,
    `verify_after_review: ${arm.verifyAfterReview.join("→") || "(none)"}`,
    `review: ${arm.reviewOutcomes.join("→") || "(none)"}`,
    `terminal_phase: ${arm.terminalPhase ?? "(none)"}`,
    `expected: ${arm.expectedOutcomeMet ? "yes" : "no"}`,
    ...arm.invocations.map(
      (item) =>
        `  ${item.invocationId} pid=${item.pid} start=${item.phaseOnStart} exit=${item.phaseOnExit} impl=${item.implementationStarted ? "yes" : "no"} skippedWorker=${item.implementationSkipped ? "yes" : "no"} skippedVerify=${item.preReviewVerifySkipped ? "yes" : "no"} reviews=${item.reviewAttempts} status=${item.workflowStatus}`,
    ),
  ].join("\n");
}

function copyIfExists(from: string, lessonDir: string): void {
  if (!fs.existsSync(from)) {
    return;
  }
  fs.copyFileSync(from, path.join(lessonDir, path.basename(from)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
