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

export const DURABILITY_PROBE_ID = "DUR01";
export const DURABILITY_TASK_ID = "T02";

export type DurableInvocationEvidence = {
  workflowId: string;
  invocationId: string;
  pid: number;
  ppid: number;
  phaseOnStart: string;
  phaseOnExit: string;
  stopAfter: "implementation_ready" | null;
  workflowStatus: string;
  specDecision: string | null;
  implementationStarted: boolean;
  specModelCalls: number;
  specToolCalls: number;
  durableCheckpoint: string | null;
  tracePath: string;
  finalVerificationPassed: boolean;
  finalReviewerOutcome: string;
  workspaceId: string | null;
  workspaceRoot: string | null;
  baseRevision: string | null;
};

export type DurableArmEvidence = {
  workflowId: string;
  workspaceId: string;
  workspaceRoot: string;
  baseRevision: string;
  workingTreeFingerprint: string;
  invocations: DurableInvocationEvidence[];
  specPhaseStartedCount: number;
  specPhaseSkippedCount: number;
  workerStarted: boolean;
  verifyOutcomes: string[];
  reviewOutcomes: string[];
  terminalPhase: string | null;
  expectedOutcomeMet: boolean;
};

export type DurabilityProbeResult = {
  taskId: typeof DURABILITY_PROBE_ID;
  taskKind: "mechanism_probe";
  mechanism: "durable_execution";
  task: typeof DURABILITY_TASK_ID;
  passed: boolean;
  control: DurableArmEvidence;
  interrupted: DurableArmEvidence;
  assertions: Record<string, boolean>;
  evidencePath: string;
};

const DECISION_RULE = [
  "DUR01 passes only if all are true:",
  "1. implementation_ready was durably persisted before process A ended.",
  "2. process B is a fresh process/invocation.",
  "3. process B loads the same workflow ID.",
  "4. process B does not execute the Spec phase again.",
  "5. process B reuses and validates the intended workspace/base provenance.",
  "6. existing Worker -> VERIFY -> REVIEW authority remains unchanged.",
  "7. expected T02 task behavior passes on both arms.",
  "8. terminal workflow state is persisted.",
  "Control (uninterrupted durable T02) must also pass.",
].join("\n");

export async function runDurabilityProbe(options: {
  prepare: (config: HarnessConfig) => { task: string; initialTestsPassed: boolean };
}): Promise<DurabilityProbeResult> {
  const stamp = timestamp();
  const storeDir = path.join(REPO_ROOT, "traces", "workflows", `DUR01-${stamp}`);
  fs.mkdirSync(storeDir, { recursive: true });

  const control = await runArm({
    storeDir,
    workflowId: `DUR01-control-${stamp}`,
    interrupt: false,
    prepare: options.prepare,
  });
  const interrupted = await runArm({
    storeDir,
    workflowId: `DUR01-interrupted-${stamp}`,
    interrupt: true,
    prepare: options.prepare,
  });

  const assertions = evaluateDurabilityAssertions(control, interrupted);

  const passed = Object.values(assertions).every(Boolean);
  const result: DurabilityProbeResult = {
    taskId: DURABILITY_PROBE_ID,
    taskKind: "mechanism_probe",
    mechanism: "durable_execution",
    task: DURABILITY_TASK_ID,
    passed,
    control,
    interrupted,
    assertions,
    evidencePath: "",
  };
  result.evidencePath = writeDurabilityEvidence(storeDir, result);
  return result;
}

export function evaluateDurabilityAssertions(
  control: DurableArmEvidence,
  interrupted: DurableArmEvidence,
): Record<string, boolean> {
  const processA = interrupted.invocations[0];
  const processB = interrupted.invocations[1];
  return {
    controlExpected: control.expectedOutcomeMet,
    controlTerminalPersisted: control.terminalPhase === "terminal",
    processAPersistedImplementationReady:
      processA?.phaseOnExit === "implementation_ready" &&
      processA.durableCheckpoint === "implementation_ready",
    processBFresh:
      Boolean(processA && processB) &&
      processA.pid !== processB.pid &&
      processA.invocationId !== processB.invocationId,
    sameWorkflowId:
      processA?.workflowId === interrupted.workflowId &&
      processB?.workflowId === interrupted.workflowId,
    processBDidNotRerunSpec:
      processB?.phaseOnStart === "implementation_ready" &&
      interrupted.specPhaseStartedCount === 1 &&
      interrupted.specPhaseSkippedCount >= 1 &&
      processB.specModelCalls === 0,
    processBReusedWorkspace:
      processA?.workspaceId === interrupted.workspaceId &&
      processB?.workspaceId === interrupted.workspaceId &&
      processA?.workspaceRoot === interrupted.workspaceRoot &&
      processB?.workspaceRoot === interrupted.workspaceRoot &&
      processA?.baseRevision === interrupted.baseRevision &&
      processB?.baseRevision === interrupted.baseRevision,
    workerVerifyReviewUnchanged:
      interrupted.workerStarted &&
      interrupted.verifyOutcomes.includes("PASS") &&
      interrupted.reviewOutcomes.includes("pass"),
    interruptedExpected: interrupted.expectedOutcomeMet,
    interruptedTerminalPersisted: interrupted.terminalPhase === "terminal",
    distinctFromControlWorkflow: control.workflowId !== interrupted.workflowId,
  };
}

export function isExpectedDurableArmOutcome(
  last: DurableInvocationEvidence,
  traces: Array<{ workerStarted: boolean }>,
): boolean {
  return (
    last.workflowStatus === "success" &&
    last.specDecision === "executable" &&
    last.implementationStarted &&
    last.finalVerificationPassed &&
    last.finalReviewerOutcome === "pass" &&
    traces.some((item) => item.workerStarted)
  );
}

export function isExpectedDUR01Outcome(result: DurabilityProbeResult): boolean {
  return result.passed;
}

export function printDurabilityProbeSummary(result: DurabilityProbeResult): void {
  console.log("\n=== DUR01 Durable Execution Probe ===");
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
  prepare: (config: HarnessConfig) => { task: string; initialTestsPassed: boolean };
}): Promise<DurableArmEvidence> {
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

    const invocations: DurableInvocationEvidence[] = [];
    if (options.interrupt) {
      invocations.push(
        runInvocation({
          storeDir: options.storeDir,
          workflowId: options.workflowId,
          runId: `${options.workflowId}-A`,
          stopAfter: "implementation_ready",
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
    const expectedOutcomeMet = isExpectedDurableArmOutcome(last, traces);

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
      workerStarted: traces.some((item) => item.workerStarted),
      verifyOutcomes: traces.flatMap((item) => item.verifyOutcomes),
      reviewOutcomes: traces.flatMap((item) => item.reviewOutcomes),
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
  stopAfter?: "implementation_ready";
}): DurableInvocationEvidence {
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
      `Durable invocation ${options.runId} failed:\n${spawned.stdout}\n${spawned.stderr}`,
    );
  }
  const evidenceFile = invocationEvidencePath(options.storeDir, options.runId);
  if (!fs.existsSync(evidenceFile)) {
    throw new Error(
      `Missing invocation evidence for ${options.runId}:\n${spawned.stdout}\n${spawned.stderr}`,
    );
  }
  return JSON.parse(fs.readFileSync(evidenceFile, "utf8")) as DurableInvocationEvidence;
}

function inspectTrace(tracePath: string): {
  specPhaseStarted: number;
  specPhaseSkipped: number;
  workerStarted: boolean;
  verifyOutcomes: string[];
  reviewOutcomes: string[];
} {
  if (!fs.existsSync(tracePath)) {
    return {
      specPhaseStarted: 0,
      specPhaseSkipped: 0,
      workerStarted: false,
      verifyOutcomes: [],
      reviewOutcomes: [],
    };
  }
  const events = fs
    .readFileSync(tracePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return {
    specPhaseStarted: events.filter((item) => item.event === "spec_phase_started")
      .length,
    specPhaseSkipped: events.filter((item) => item.event === "spec_phase_skipped")
      .length,
    workerStarted: events.some((item) => item.event === "implementation_started"),
    verifyOutcomes: events
      .filter((item) => item.event === "verification_attempt")
      .map((item) => (item.passed ? "PASS" : "FAIL")),
    reviewOutcomes: events
      .filter((item) => item.event === "review_completed")
      .map((item) => String(item.status ?? "unknown")),
  };
}

function writeDurabilityEvidence(
  storeDir: string,
  result: DurabilityProbeResult,
): string {
  const stamp = timestamp();
  const tracesDir = path.join(REPO_ROOT, "traces");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/16-durable-execution/traces",
  );
  fs.mkdirSync(tracesDir, { recursive: true });
  fs.mkdirSync(lessonDir, { recursive: true });
  const payload = `${JSON.stringify({ ...result, decisionRule: DECISION_RULE }, null, 2)}\n`;
  const report = `${formatDurabilityReport(result)}\n`;
  const jsonName = `DUR01-durable-${stamp}.json`;
  const reportName = `DUR01-durable-${stamp}.txt`;
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

function formatDurabilityReport(result: DurabilityProbeResult): string {
  const lines = [
    "=== DUR01 Durable Execution Probe ===",
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
  ];
  return lines.join("\n");
}

function formatArm(arm: DurableArmEvidence): string {
  return [
    `workflowId: ${arm.workflowId}`,
    `workspace: ${arm.workspaceId} @ ${arm.baseRevision.slice(0, 12)}`,
    `spec_phase_started: ${arm.specPhaseStartedCount}`,
    `spec_phase_skipped: ${arm.specPhaseSkippedCount}`,
    `worker_started: ${arm.workerStarted ? "yes" : "no"}`,
    `verify: ${arm.verifyOutcomes.join("→") || "(none)"}`,
    `review: ${arm.reviewOutcomes.join("→") || "(none)"}`,
    `terminal_phase: ${arm.terminalPhase ?? "(none)"}`,
    `expected: ${arm.expectedOutcomeMet ? "yes" : "no"}`,
    ...arm.invocations.map(
      (item) =>
        `  ${item.invocationId} pid=${item.pid} start=${item.phaseOnStart} exit=${item.phaseOnExit} specCalls=${item.specModelCalls} impl=${item.implementationStarted ? "yes" : "no"} status=${item.workflowStatus}`,
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
