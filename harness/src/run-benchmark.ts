import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ContextMode } from "./context.ts";
import type { HarnessConfig } from "./config.ts";
import { REPO_ROOT, loadConfig } from "./config.ts";
import { snapshotDirectory } from "./diff.ts";
import {
  printHarnessResult,
  runV1Harness,
  type HarnessRunResult,
} from "./run.ts";
import { aggregateRuns } from "./eval/aggregate.ts";
import { normalizeRun } from "./eval/normalize.ts";
import type { EvalResult, FixedTaskId } from "./eval/types.ts";
import { writeEvalArtifact } from "./eval/write.ts";
import type { ConversationStateMode } from "./loop.ts";
import {
  isExpectedISO01Outcome,
  printIsolationProbeSummary,
  runIsolationProbe,
} from "./iso01.ts";
import {
  isExpectedSEC01Outcome,
  printSecurityProbeSummary,
  runSecurityProbe,
} from "./sec01.ts";
import { injectMissingTask500Fault } from "./r01-fault.ts";
import { injectArch01CompleteTaskFault } from "./rev01-fault.ts";
import { ARCH_01, isIntendedArch01Finding } from "./review.ts";
import {
  ROUTING_DEFAULT_MODEL,
  ROUTING_REPAIR_CANDIDATE,
  runRoutingExperiment,
  writeRoutingExperimentArtifact,
  type RoutingArmId,
  type RoutingProbeAttempt,
} from "./routing-experiment.ts";
import {
  runOrchestrationExperiment,
  writeOrchestrationExperimentArtifact,
  type OrchestrationArmId,
} from "./orchestration-experiment.ts";
import {
  isExpectedP01Outcome,
  runPlanningExperiment,
  writePlanningExperimentArtifact,
  type PlanningArmId,
  type PlanningProbeAttempt,
} from "./planning-experiment.ts";
import {
  runSubagentsExperiment,
  writeSubagentsExperimentArtifact,
  type SubagentsArmId,
  type SubagentsProbeAttempt,
} from "./subagents-experiment.ts";
import {
  runDecompositionExperiment,
  writeDecompositionExperimentArtifact,
  isExpectedP02Outcome,
  bindP02ReviewPlan,
  P02_REVIEW_UNIT_TEMPLATES,
  type DecompositionArmId,
  type DecompositionProbeAttempt,
} from "./decomposition-experiment.ts";
import { runFinalVerification } from "./verify.ts";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  type Workspace,
} from "./workspace.ts";

const TASK_IDS = ["T01", "T02", "T03", "T04"] as const;
type TaskId = (typeof TASK_IDS)[number];

export type BenchmarkPrepResult = {
  taskId: TaskId;
  task: string;
  initialTestsPassed: boolean;
  initialTestOutput: string;
};

export type BenchmarkRunLabel = {
  taskId: TaskId;
  contextMode: ContextMode;
};

export function prepareP02(config: HarnessConfig): {
  task: string;
  initialTestsPassed: boolean;
  initialTestOutput: string;
} {
  restoreFixture(config, path.join(config.repoRoot, "benchmarks"));
  const hostP02 = path.join(REPO_ROOT, "benchmarks", "P02");
  const taskPath = path.join(hostP02, "task.md");
  const testFiles = [
    "due-date-capability.test.ts",
    "due-date-mutation.test.ts",
    "due-overdue.test.ts",
  ];
  if (!fs.existsSync(taskPath)) {
    throw new Error(`Missing P02 fixture files under ${hostP02}`);
  }
  const testsDir = path.join(config.targetAppRoot, "tests");
  fs.mkdirSync(testsDir, { recursive: true });
  for (const file of testFiles) {
    const from = path.join(hostP02, file);
    if (!fs.existsSync(from)) {
      throw new Error(`Missing P02 test file: ${from}`);
    }
    fs.copyFileSync(from, path.join(testsDir, file));
  }
  const task = fs.readFileSync(taskPath, "utf8").trim();
  const verification = runFinalVerification(config);
  return {
    task,
    initialTestsPassed: verification.passed,
    initialTestOutput: verification.output,
  };
}

export function prepareP01(config: HarnessConfig): {
  task: string;
  initialTestsPassed: boolean;
  initialTestOutput: string;
} {
  restoreFixture(config, path.join(config.repoRoot, "benchmarks"));
  const hostP01 = path.join(REPO_ROOT, "benchmarks", "P01");
  const taskPath = path.join(hostP01, "task.md");
  const testPath = path.join(hostP01, "priority.test.ts");
  if (!fs.existsSync(taskPath) || !fs.existsSync(testPath)) {
    throw new Error(`Missing P01 fixture files under ${hostP01}`);
  }
  const task = fs.readFileSync(taskPath, "utf8").trim();
  fs.copyFileSync(
    testPath,
    path.join(config.targetAppRoot, "tests", "priority.test.ts"),
  );
  const verification = runFinalVerification(config);
  return {
    task,
    initialTestsPassed: verification.passed,
    initialTestOutput: verification.output,
  };
}

export function prepareBenchmark(
  taskId: TaskId,
  config: HarnessConfig,
): BenchmarkPrepResult {
  const benchmarksRoot = path.join(config.repoRoot, "benchmarks");
  restoreFixture(config, benchmarksRoot);

  const taskDir = path.join(benchmarksRoot, taskId);
  const taskPath = path.join(taskDir, "task.md");
  if (!fs.existsSync(taskPath)) {
    throw new Error(`Missing task file: ${taskPath}`);
  }
  const task = fs.readFileSync(taskPath, "utf8").trim();

  const patchPath = path.join(taskDir, "setup.patch");
  if (fs.existsSync(patchPath)) {
    applyPatch(patchPath, config.targetSrcRoot);
  }

  const verification = runFinalVerification(config);

  return {
    taskId,
    task,
    initialTestsPassed: verification.passed,
    initialTestOutput: verification.output,
  };
}

export type BenchmarkRunOptions = {
  conversationStateMode?: ConversationStateMode;
};

export async function runBenchmark(
  taskId: TaskId,
  contextMode: ContextMode = "baseline",
  options: BenchmarkRunOptions = {},
): Promise<HarnessRunResult> {
  const conversationStateMode = options.conversationStateMode ?? "manual";
  const runId = `${taskId}-${contextMode}-${conversationStateMode}-${timestamp()}`;
  return withIsolatedWorkspace(runId, async (config, workspace) => {
    const prep = prepareBenchmark(taskId, config);

    if (taskId !== "T04" && prep.initialTestsPassed) {
      throw new Error(
        `${taskId}: expected initial tests to FAIL after setup, but they passed.`,
      );
    }

    console.log(
      `\n=== Preparing ${taskId} (${contextMode}, ${conversationStateMode}) ===`,
    );
    console.log(`initial_tests: ${prep.initialTestsPassed ? "PASS" : "FAIL"}`);
    console.log(
      `workspace: ${workspace.id} @ ${workspace.baseRevision.slice(0, 12)}`,
    );

    const beforeSnapshot = snapshotDirectory(config.targetSrcRoot);
    const result = await runV1Harness({
      config,
      task: prep.task,
      runId,
      beforeSnapshot,
      contextMode,
      conversationStateMode,
      workspace,
    });

    printHarnessResult(result);
    return result;
  });
}

export async function runContextExperiment(): Promise<
  Array<{ label: BenchmarkRunLabel; result: HarnessRunResult }>
> {
  const runs: Array<{ label: BenchmarkRunLabel; result: HarnessRunResult }> =
    [];

  for (const taskId of TASK_IDS) {
    for (const contextMode of ["baseline", "variant"] as const) {
      const result = await runBenchmark(taskId, contextMode);
      runs.push({ label: { taskId, contextMode }, result });
    }
  }

  printExperimentSummary(runs);
  return runs;
}

export function scoreExpectedOutcome(
  taskId: FixedTaskId,
  result: HarnessRunResult,
): boolean {
  if (taskId === "R01") {
    return isExpectedR01Outcome(result);
  }
  if (taskId === "REV01") {
    return isExpectedREV01Outcome(result);
  }
  return isExpectedV1Outcome(taskId, result);
}

export function runIdFromTracePath(tracePath: string): string {
  return path.basename(tracePath, ".jsonl");
}

export async function runFixedSuite(
  options: {
    conversationStateMode?: ConversationStateMode;
  } = {},
): Promise<EvalResult> {
  const conversationStateMode = options.conversationStateMode ?? "manual";
  const isolation = runIsolationProbe();
  printIsolationProbeSummary(isolation);
  const security = runSecurityProbe();
  printSecurityProbeSummary(security);

  const labeled: Array<{ taskId: FixedTaskId; result: HarnessRunResult }> = [];

  for (const taskId of TASK_IDS) {
    labeled.push({
      taskId,
      result: await runBenchmark(taskId, "variant", { conversationStateMode }),
    });
  }
  labeled.push({
    taskId: "R01",
    result: await runRepairProbe(undefined, conversationStateMode),
  });
  labeled.push({
    taskId: "REV01",
    result: await runReviewProbe(conversationStateMode),
  });

  const metrics = labeled.map(({ taskId, result }) =>
    normalizeRun({
      taskId,
      runId: runIdFromTracePath(result.tracePath),
      result,
      expectedOutcomeMet: scoreExpectedOutcome(taskId, result),
    }),
  );
  const evalResult = aggregateRuns(metrics, { isolation, security });
  const artifacts = writeEvalArtifact({
    evalsDir: path.join(REPO_ROOT, "evals"),
    result: evalResult,
  });

  console.log(`\n${evalResult.report}`);
  console.log(`\neval_json: ${artifacts.jsonPath}`);
  console.log(`eval_report: ${artifacts.reportPath}`);
  return evalResult;
}

export function isExpectedV1Outcome(
  taskId: TaskId,
  result: HarnessRunResult,
): boolean {
  if (taskId === "T04") {
    return (
      result.workflowStatus === "needs_human_judgment" &&
      result.specDecision?.status === "needs_human_judgment" &&
      result.implementationStarted === false &&
      result.changedFiles.length === 0 &&
      result.unresolvedQuestions.length > 0
    );
  }
  return (
    result.workflowStatus === "success" &&
    result.specDecision?.status === "executable" &&
    result.implementationStarted === true &&
    result.finalVerificationPassed
  );
}

export type RepairProbeOverlay = {
  model?: string;
  repairModel?: string | null;
};

export async function executeRepairProbe(options: {
  runId: string;
  overlay?: RepairProbeOverlay;
  conversationStateMode?: ConversationStateMode;
  print?: boolean;
}): Promise<RoutingProbeAttempt> {
  const print = options.print !== false;
  const conversationStateMode = options.conversationStateMode ?? "manual";
  return withIsolatedWorkspace(
    options.runId,
    async (config, workspace) => {
      let injected = false;
      try {
        restoreFixture(config, path.join(config.repoRoot, "benchmarks"));

        const taskPath = path.join(
          config.repoRoot,
          "benchmarks",
          "R01",
          "task.md",
        );
        if (!fs.existsSync(taskPath)) {
          throw new Error(`Missing R01 task file: ${taskPath}`);
        }
        const task = fs.readFileSync(taskPath, "utf8").trim();

        const initial = runFinalVerification(config);
        if (!initial.passed) {
          throw new Error(
            `R01: expected green fixture tests to PASS before the probe, but they failed.\n${initial.output}`,
          );
        }

        console.log("\n=== Preparing R01 (controlled repair probe) ===");
        console.log(
          "initial_tests: PASS (green fixture; defect injected after implementation)",
        );
        console.log(
          `workspace: ${workspace.id} @ ${workspace.baseRevision.slice(0, 12)}`,
        );
        console.log(
          `model: ${config.model} | repair_model: ${config.repairModel ?? "(default)"}`,
        );

        const beforeSnapshot = snapshotDirectory(config.targetSrcRoot);

        const result = await runV1Harness({
          config,
          task,
          runId: options.runId,
          beforeSnapshot,
          contextMode: "variant",
          conversationStateMode,
          workspace,
          afterImplementationEpisode: () => {
            if (injected) {
              throw new Error("R01 fault injection ran more than once.");
            }
            injectMissingTask500Fault(config.targetSrcRoot);
            injected = true;
            console.log(
              "R01: injected getTask missing-task 404 → 500 after implementation",
            );
          },
        });

        if (print) {
          printHarnessResult(result);
          printRepairProbeSummary(result);
        }
        return { injected, result, error: null };
      } catch (error) {
        return {
          injected,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    options.overlay,
  );
}

export async function runRepairProbe(
  overlay?: RepairProbeOverlay,
  conversationStateMode: ConversationStateMode = "manual",
): Promise<HarnessRunResult> {
  const runId = `R01-repair-${timestamp()}`;
  const attempt = await executeRepairProbe({
    runId,
    overlay,
    conversationStateMode,
  });
  if (!attempt.injected || !attempt.result) {
    throw new Error(
      attempt.error ??
        "R01: implementation episode finished without fault injection (spec likely did not start implementation).",
    );
  }
  return attempt.result;
}

export async function runModelRoutingExperiment() {
  return runRoutingExperiment({
    runTrial: async (arm: RoutingArmId, runId: string) =>
      executeRepairProbe({
        runId,
        overlay: {
          model: ROUTING_DEFAULT_MODEL,
          repairModel: arm === "variant" ? ROUTING_REPAIR_CANDIDATE : null,
        },
      }),
    scoreExpected: isExpectedR01Outcome,
  });
}

export async function executeP01Trial(options: {
  arm: PlanningArmId;
  runId: string;
}): Promise<PlanningProbeAttempt> {
  return withIsolatedWorkspace(options.runId, async (config, workspace) => {
    let fixtureApplied = false;
    try {
      const prep = prepareP01(config);
      if (prep.initialTestsPassed) {
        return {
          fixtureApplied: false,
          result: null,
          error:
            "P01: expected initial tests to FAIL after priority tests were added, but they passed.",
        };
      }
      fixtureApplied = true;
      console.log(
        `\n=== Preparing P01 (${options.arm}) workspace=${workspace.id} ===`,
      );
      console.log(
        "initial_tests: FAIL (priority tests added to green fixture)",
      );
      const beforeSnapshot = snapshotDirectory(config.targetSrcRoot);
      const result = await runV1Harness({
        config,
        task: prep.task,
        runId: options.runId,
        beforeSnapshot,
        contextMode: "variant",
        conversationStateMode: "manual",
        planningEnabled: options.arm === "variant",
        workspace,
      });
      printHarnessResult(result);
      return { fixtureApplied: true, result, error: null };
    } catch (error) {
      return {
        fixtureApplied,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export async function runPlannerWorkerExperiment() {
  return runPlanningExperiment({
    runTrial: (arm, runId) => executeP01Trial({ arm, runId }),
    scoreExpected: isExpectedP01Outcome,
  });
}

export async function executeP01SubagentsTrial(options: {
  arm: SubagentsArmId;
  runId: string;
}): Promise<SubagentsProbeAttempt> {
  return withIsolatedWorkspace(options.runId, async (config, workspace) => {
    let fixtureApplied = false;
    try {
      const prep = prepareP01(config);
      if (prep.initialTestsPassed) {
        return {
          fixtureApplied: false,
          result: null,
          error:
            "P01: expected initial tests to FAIL after priority tests were added, but they passed.",
        };
      }
      fixtureApplied = true;
      console.log(
        `\n=== Preparing P01 subagents (${options.arm}) workspace=${workspace.id} ===`,
      );
      console.log(
        "initial_tests: FAIL (priority tests added to green fixture)",
      );
      const beforeSnapshot = snapshotDirectory(config.targetSrcRoot);
      const result = await runV1Harness({
        config,
        task: prep.task,
        runId: options.runId,
        beforeSnapshot,
        contextMode: "variant",
        conversationStateMode: "manual",
        subagentsEnabled: options.arm === "variant",
        workspace,
      });
      printHarnessResult(result);
      return { fixtureApplied: true, result, error: null };
    } catch (error) {
      return {
        fixtureApplied,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export async function runResearchSubagentExperiment() {
  return runSubagentsExperiment({
    runTrial: (arm, runId) => executeP01SubagentsTrial({ arm, runId }),
    scoreExpected: isExpectedP01Outcome,
  });
}

export async function executeP02Trial(options: {
  arm: DecompositionArmId;
  runId: string;
}): Promise<DecompositionProbeAttempt> {
  return withIsolatedWorkspace(options.runId, async (config, workspace) => {
    let fixtureApplied = false;
    try {
      const prep = prepareP02(config);
      if (prep.initialTestsPassed) {
        return {
          fixtureApplied: false,
          result: null,
          error:
            "P02: expected initial tests to FAIL after due-date tests were added, but they passed.",
        };
      }
      fixtureApplied = true;
      console.log(
        `\n=== Preparing P02 (${options.arm}) workspace=${workspace.id} ===`,
      );
      console.log(
        "initial_tests: FAIL (due-date tests added to green fixture)",
      );
      const beforeSnapshot = snapshotDirectory(config.targetSrcRoot);
      const result = await runV1Harness({
        config,
        task: prep.task,
        runId: options.runId,
        beforeSnapshot,
        contextMode: "variant",
        conversationStateMode: "manual",
        workspace,
        ...(options.arm === "variant"
          ? {
              bindReviewPlan: bindP02ReviewPlan,
              reviewUnitTemplates: P02_REVIEW_UNIT_TEMPLATES,
            }
          : {}),
      });
      printHarnessResult(result);
      return { fixtureApplied: true, result, error: null };
    } catch (error) {
      return {
        fixtureApplied,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export async function runP02DecompositionExperiment() {
  return runDecompositionExperiment({
    runTrial: (arm, runId) => executeP02Trial({ arm, runId }),
    scoreExpected: isExpectedP02Outcome,
  });
}

export async function runConversationStateExperiment() {
  return runOrchestrationExperiment({
    runTrial: async (arm: OrchestrationArmId, runId: string) =>
      withIsolatedWorkspace(runId, async (config, workspace) => {
        const prep = prepareBenchmark("T02", config);
        if (prep.initialTestsPassed) {
          throw new Error(
            "T02: expected initial tests to FAIL after setup, but they passed.",
          );
        }
        console.log(
          `\n=== Preparing T02 (variant, ${arm}) workspace=${workspace.id} ===`,
        );
        const beforeSnapshot = snapshotDirectory(config.targetSrcRoot);
        const result = await runV1Harness({
          config,
          task: prep.task,
          runId,
          beforeSnapshot,
          contextMode: "variant",
          conversationStateMode: arm,
          workspace,
        });
        printHarnessResult(result);
        return result;
      }),
    scoreExpected: (result) => isExpectedV1Outcome("T02", result),
  });
}

export function isExpectedR01Outcome(result: HarnessRunResult): boolean {
  const first = result.verifications[0];
  const second = result.verifications[1];
  const repair = result.repairs[0];
  const repairChangedOnlySource =
    Boolean(repair) &&
    repair.changedFiles.length > 0 &&
    repair.changedFiles.every((file) => isAllowedRepairPath(file));
  const finalChangedOnlySource = result.changedFiles.every((file) =>
    isAllowedRepairPath(file),
  );

  return (
    result.workflowStatus === "success" &&
    result.specDecision?.status === "executable" &&
    result.implementationStarted === true &&
    result.verificationAttempts === 2 &&
    result.repairAttempts === 1 &&
    result.repeatedFailure === false &&
    first?.passed === false &&
    first.normalizedFailure !== null &&
    second?.passed === true &&
    result.finalVerificationPassed === true &&
    Boolean(repair) &&
    repair.receivedTerminalResponse === true &&
    repairChangedOnlySource &&
    finalChangedOnlySource
  );
}

function isAllowedRepairPath(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  if (
    normalized.includes("test") ||
    normalized.includes("spec") ||
    normalized.includes("verify") ||
    normalized.includes("harness/")
  ) {
    return false;
  }
  return true;
}

function printRepairProbeSummary(result: HarnessRunResult): void {
  const expected = isExpectedR01Outcome(result) ? "expected" : "UNEXPECTED";
  const first = result.verifications[0];
  const second = result.verifications[1];
  console.log("\n=== R01 Repair Probe Summary ===");
  console.log(
    `first_verify: ${first ? (first.passed ? "PASS" : "FAIL") : "missing"}`,
  );
  console.log(`normalized_failure: ${first?.normalizedFailure ? "yes" : "no"}`);
  console.log(`repair_attempts: ${result.repairAttempts}`);
  console.log(
    `second_verify: ${second ? (second.passed ? "PASS" : "FAIL") : "missing"}`,
  );
  console.log(`workflow_status: ${result.workflowStatus}`);
  console.log(
    `repair_changed_files: ${result.repairs[0]?.changedFiles.join(", ") || "(none)"}`,
  );
  console.log(`skill_loads: ${formatProbeSkillLoads(result)}`);
  console.log(`outcome: ${expected}`);
}

export async function runReviewProbe(
  conversationStateMode: ConversationStateMode = "manual",
): Promise<HarnessRunResult> {
  const runId = `REV01-review-${timestamp()}`;
  return withIsolatedWorkspace(runId, async (config, workspace) => {
    restoreFixture(config, path.join(config.repoRoot, "benchmarks"));

    const taskPath = path.join(
      config.repoRoot,
      "benchmarks",
      "REV01",
      "task.md",
    );
    if (!fs.existsSync(taskPath)) {
      throw new Error(`Missing REV01 task file: ${taskPath}`);
    }
    const task = fs.readFileSync(taskPath, "utf8").trim();

    const initial = runFinalVerification(config);
    if (!initial.passed) {
      throw new Error(
        `REV01: expected green fixture tests to PASS before the probe, but they failed.\n${initial.output}`,
      );
    }

    console.log(
      "\n=== Preparing REV01 (controlled independent review probe) ===",
    );
    console.log(
      "initial_tests: PASS (green fixture; ARCH-01 defect injected after implementation)",
    );
    console.log(
      `workspace: ${workspace.id} @ ${workspace.baseRevision.slice(0, 12)}`,
    );

    const beforeSnapshot = snapshotDirectory(config.targetSrcRoot);
    let injected = false;

    const result = await runV1Harness({
      config,
      task,
      runId,
      beforeSnapshot,
      contextMode: "variant",
      conversationStateMode,
      workspace,
      architectureConstraints: [ARCH_01],
      afterImplementationEpisode: () => {
        if (injected) {
          throw new Error("REV01 fault injection ran more than once.");
        }
        injectArch01CompleteTaskFault(config.targetSrcRoot);
        injected = true;
        console.log(
          "REV01: injected completeTask route-owned status/completedAt mutation after implementation",
        );
      },
    });

    if (!injected) {
      throw new Error(
        "REV01: implementation episode finished without fault injection (spec likely did not start implementation).",
      );
    }

    printHarnessResult(result);
    printReviewProbeSummary(result);
    return result;
  });
}

export function isExpectedREV01Outcome(result: HarnessRunResult): boolean {
  const review1 = result.reviews[0];
  const review2 = result.reviews[1];
  const reviewRepair = result.reviewRepairs[0];
  const reviewRepairChangedOnlySource =
    Boolean(reviewRepair) &&
    reviewRepair.changedFiles.length > 0 &&
    reviewRepair.changedFiles.every((file) => isAllowedRepairPath(file));
  const review2HasNoAcceptedBlocker =
    Boolean(review2) &&
    review2.decisions.every((item) => item.decision !== "accepted_blocking");
  const intendedOnReview1 = Boolean(
    review1?.decisions.some(
      (item) =>
        item.decision === "accepted_blocking" &&
        isIntendedArch01Finding(item.finding),
    ),
  );
  const exactlyTwoPassPass =
    result.verifications.length === 2 &&
    result.verifications[0]?.passed === true &&
    result.verifications[1]?.passed === true;

  return (
    result.workflowStatus === "success" &&
    result.specDecision?.status === "executable" &&
    result.implementationStarted === true &&
    exactlyTwoPassPass &&
    result.repairAttempts === 0 &&
    result.reviewAttempts === 2 &&
    intendedOnReview1 &&
    result.intendedFindingDetected === true &&
    result.blockingFalsePositives.length === 0 &&
    result.reviewRepairAttempts === 1 &&
    reviewRepairChangedOnlySource &&
    result.finalVerificationPassed === true &&
    review2HasNoAcceptedBlocker &&
    result.finalReviewerOutcome === "pass" &&
    result.repeatedFinding === false
  );
}

function printReviewProbeSummary(result: HarnessRunResult): void {
  const expected = isExpectedREV01Outcome(result) ? "expected" : "UNEXPECTED";
  const first = result.verifications[0];
  const last = result.verifications[result.verifications.length - 1];
  console.log("\n=== REV01 Independent Review Probe Summary ===");
  console.log(
    `first_verify: ${first ? (first.passed ? "PASS" : "FAIL") : "missing"}`,
  );
  console.log(`review_attempts: ${result.reviewAttempts}`);
  console.log(
    `review1_findings: ${result.reviews[0]?.findings.length ?? 0} | intended: ${result.intendedFindingDetected}`,
  );
  console.log(
    `accepted_blocking: ${result.acceptedBlockingFindings.length} | non_blocking: ${result.acceptedNonBlockingFindings.length} | rejected: ${result.rejectedFindings.length} | blocking_fp: ${result.blockingFalsePositives.length}`,
  );
  console.log(`review_repair_attempts: ${result.reviewRepairAttempts}`);
  console.log(
    `review_repair_changed_files: ${result.reviewRepairs[0]?.changedFiles.join(", ") || "(none)"}`,
  );
  console.log(
    `verify_after_repair: ${last ? (last.passed ? "PASS" : "FAIL") : "missing"}`,
  );
  console.log(`reviewer_outcome: ${result.finalReviewerOutcome}`);
  console.log(`workflow_status: ${result.workflowStatus}`);
  console.log(`skill_loads: ${formatProbeSkillLoads(result)}`);
  console.log(`outcome: ${expected}`);
}

export function printExperimentSummary(
  runs: Array<{ label: BenchmarkRunLabel; result: HarnessRunResult }>,
): void {
  console.log("\n=== Context Experiment Summary ===");
  console.log(
    "task | mode | spec | impl | tests | model(spec) | tools(spec) | list(spec) | read(spec) | list(impl) | read(impl) | overlap_read | nav_before_write | prep_ms | wall_ms | expected",
  );

  for (const { label, result } of runs) {
    const metrics = result.contextMetrics;
    const expected = isExpectedV1Outcome(label.taskId, result)
      ? "expected"
      : "UNEXPECTED";
    const tests = result.implementationStarted
      ? result.finalVerificationPassed
        ? "PASS"
        : "FAIL"
      : "skipped";

    console.log(
      [
        label.taskId,
        label.contextMode,
        result.specDecision?.status ?? "none",
        result.implementationStarted ? "yes" : "no",
        tests,
        `${result.modelCalls}(${result.specModelCalls})`,
        `${result.toolCalls}(${result.specToolCalls})`,
        metrics.specDiscovery.listFilesCalls,
        metrics.specDiscovery.readFileCalls,
        metrics.implDiscovery?.listFilesCalls ?? "n/a",
        metrics.implDiscovery?.readFileCalls ?? "n/a",
        metrics.pathOverlap?.readFileOverlap.join("|") || "(none)",
        metrics.implNavCallsBeforeFirstWrite ?? "n/a",
        metrics.preparation?.durationMs ?? 0,
        result.durationMs,
        expected,
      ].join(" | "),
    );
  }
}

async function withIsolatedWorkspace<T>(
  runId: string,
  fn: (config: HarnessConfig, workspace: Workspace) => Promise<T>,
  overlay?: RepairProbeOverlay,
): Promise<T> {
  const workspace = createWorkspace({
    hostRepoRoot: REPO_ROOT,
    id: runId,
  });
  try {
    const config = bindConfig(
      applyProbeOverlay(loadConfig(), overlay),
      workspace,
    );
    return await fn(config, workspace);
  } finally {
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
  }
}

function applyProbeOverlay(
  loaded: HarnessConfig,
  overlay?: RepairProbeOverlay,
): HarnessConfig {
  if (!overlay) {
    return loaded;
  }
  const next: HarnessConfig = {
    ...loaded,
    ...(overlay.model ? { model: overlay.model } : {}),
  };
  if ("repairModel" in overlay) {
    if (overlay.repairModel) {
      next.repairModel = overlay.repairModel;
    } else {
      delete next.repairModel;
    }
  }
  return next;
}

function restoreFixture(config: HarnessConfig, benchmarksRoot: string): void {
  const fixtureSrc = path.join(benchmarksRoot, "fixtures", "base-src");
  fs.rmSync(config.targetSrcRoot, { recursive: true, force: true });
  fs.mkdirSync(config.targetSrcRoot, { recursive: true });
  copyDir(fixtureSrc, config.targetSrcRoot);
}

function applyPatch(patchPath: string, targetSrcRoot: string): void {
  const result = spawnSync(
    "patch",
    ["-p0", "--batch", "--forward", "-i", patchPath],
    {
      cwd: targetSrcRoot,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to apply patch ${patchPath}\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function formatProbeSkillLoads(result: HarnessRunResult): string {
  if (result.skillLoads.length === 0) {
    return "(none)";
  }
  return result.skillLoads
    .map((item) => `${item.skillId}@${item.phase} ${item.contentHash}`)
    .join("; ");
}

type CliOptions = {
  all: boolean;
  experiment: boolean;
  repairProbe: boolean;
  reviewProbe: boolean;
  isolationProbe: boolean;
  securityProbe: boolean;
  evalSuite: boolean;
  routingExperiment: boolean;
  orchestrationExperiment?: boolean;
  planningExperiment?: boolean;
  subagentsExperiment?: boolean;
  decompositionExperiment?: boolean;
  taskId?: TaskId;
  contextMode: ContextMode;
  conversationStateMode: ConversationStateMode;
};

function parseArgs(argv: string[]): CliOptions {
  const contextMode: ContextMode = argv.includes("--variant")
    ? "variant"
    : "baseline";
  const conversationStateMode: ConversationStateMode = argv.includes(
    "--previous-response-id",
  )
    ? "previous_response_id"
    : "manual";

  if (argv.includes("--eval") || argv.includes("--fixed-suite")) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: true,
      routingExperiment: false,
      contextMode,
      conversationStateMode,
    };
  }
  if (argv.includes("--subagents") || argv.includes("subagents")) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      subagentsExperiment: true,
      contextMode: "variant",
      conversationStateMode,
    };
  }
  if (argv.includes("--decomposition") || argv.includes("decomposition")) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      decompositionExperiment: true,
      contextMode: "variant",
      conversationStateMode,
    };
  }
  if (argv.includes("--planning") || argv.includes("planning")) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      planningExperiment: true,
      contextMode: "variant",
      conversationStateMode,
    };
  }
  if (argv.includes("--orchestration") || argv.includes("orchestration")) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      orchestrationExperiment: true,
      contextMode: "variant",
      conversationStateMode,
    };
  }
  if (argv.includes("--routing") || argv.includes("routing")) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: true,
      contextMode,
      conversationStateMode,
    };
  }
  if (argv.includes("--experiment")) {
    return {
      all: false,
      experiment: true,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      contextMode,
      conversationStateMode,
    };
  }
  if (argv.includes("SEC01") || argv.includes("--security-probe")) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: true,
      evalSuite: false,
      routingExperiment: false,
      contextMode,
      conversationStateMode,
    };
  }
  if (argv.includes("ISO01") || argv.includes("--isolation-probe")) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: true,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      contextMode,
      conversationStateMode,
    };
  }
  if (argv.includes("REV01") || argv.includes("--review-probe")) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: true,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      contextMode,
      conversationStateMode,
    };
  }
  if (argv.includes("R01") || argv.includes("--repair-probe")) {
    return {
      all: false,
      experiment: false,
      repairProbe: true,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      contextMode,
      conversationStateMode,
    };
  }
  if (argv.includes("--all")) {
    return {
      all: true,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      contextMode,
      conversationStateMode,
    };
  }
  const taskId = argv.find((arg) => TASK_IDS.includes(arg as TaskId)) as
    | TaskId
    | undefined;
  if (!taskId) {
    return {
      all: false,
      experiment: false,
      repairProbe: false,
      reviewProbe: false,
      isolationProbe: false,
      securityProbe: false,
      evalSuite: false,
      routingExperiment: false,
      contextMode,
      conversationStateMode,
    };
  }
  return {
    all: false,
    experiment: false,
    repairProbe: false,
    reviewProbe: false,
    isolationProbe: false,
    securityProbe: false,
    evalSuite: false,
    routingExperiment: false,
    taskId,
    contextMode,
    conversationStateMode,
  };
}

async function main(): Promise<void> {
  const {
    all,
    experiment,
    repairProbe,
    reviewProbe,
    isolationProbe,
    securityProbe,
    evalSuite,
    routingExperiment,
    orchestrationExperiment,
    planningExperiment,
    subagentsExperiment,
    decompositionExperiment,
    taskId,
    contextMode,
    conversationStateMode,
  } = parseArgs(process.argv.slice(2));

  if (securityProbe) {
    const result = runSecurityProbe();
    printSecurityProbeSummary(result);
    process.exit(isExpectedSEC01Outcome(result) ? 0 : 1);
    return;
  }

  if (isolationProbe) {
    const result = runIsolationProbe();
    printIsolationProbeSummary(result);
    process.exit(isExpectedISO01Outcome(result) ? 0 : 1);
    return;
  }

  if (evalSuite) {
    const evalResult = await runFixedSuite({ conversationStateMode });
    process.exit(evalResult.regressions.length === 0 ? 0 : 1);
    return;
  }

  if (planningExperiment) {
    const result = await runPlannerWorkerExperiment();
    const artifacts = writePlanningExperimentArtifact(result);
    console.log(`\n${result.report}`);
    console.log(`\nplanning_json: ${artifacts.jsonPath}`);
    console.log(`planning_report: ${artifacts.reportPath}`);
    process.exit(
      result.baseline.validTrials === 3 && result.variant.validTrials === 3
        ? 0
        : 1,
    );
    return;
  }

  if (subagentsExperiment) {
    const result = await runResearchSubagentExperiment();
    const artifacts = writeSubagentsExperimentArtifact(result);
    console.log(`\n${result.report}`);
    console.log(`\nsubagents_json: ${artifacts.jsonPath}`);
    console.log(`subagents_report: ${artifacts.reportPath}`);
    process.exit(
      result.baseline.validTrials === 3 && result.variant.validTrials === 3
        ? 0
        : 1,
    );
    return;
  }

  if (decompositionExperiment) {
    const result = await runP02DecompositionExperiment();
    const artifacts = writeDecompositionExperimentArtifact(result);
    console.log(`\n${result.report}`);
    console.log(`\ndecomposition_json: ${artifacts.jsonPath}`);
    console.log(`decomposition_report: ${artifacts.reportPath}`);
    process.exit(
      result.baseline.validTrials === 3 && result.variant.validTrials === 3
        ? 0
        : 1,
    );
    return;
  }

  if (orchestrationExperiment) {
    const result = await runConversationStateExperiment();
    const artifacts = writeOrchestrationExperimentArtifact(result);
    console.log(`\n${result.report}`);
    console.log(`\norchestration_json: ${artifacts.jsonPath}`);
    console.log(`orchestration_report: ${artifacts.reportPath}`);
    process.exit(
      result.manual.expectedMet === 3 &&
        result.previousResponseId.expectedMet === 3
        ? 0
        : 1,
    );
    return;
  }

  if (routingExperiment) {
    const result = await runModelRoutingExperiment();
    const artifacts = writeRoutingExperimentArtifact(result);
    console.log(`\n${result.report}`);
    console.log(`\nrouting_json: ${artifacts.jsonPath}`);
    console.log(`routing_report: ${artifacts.reportPath}`);
    process.exit(0);
    return;
  }

  if (reviewProbe) {
    const result = await runReviewProbe(conversationStateMode);
    process.exit(isExpectedREV01Outcome(result) ? 0 : 1);
    return;
  }

  if (repairProbe) {
    const result = await runRepairProbe(undefined, conversationStateMode);
    process.exit(isExpectedR01Outcome(result) ? 0 : 1);
    return;
  }

  if (experiment) {
    const runs = await runContextExperiment();
    const allExpected = runs.every(({ label, result }) =>
      isExpectedV1Outcome(label.taskId, result),
    );
    process.exit(allExpected ? 0 : 1);
    return;
  }

  if (!all && !taskId) {
    console.error(
      "Usage: npm run benchmark -- T01|T02|T03|T04 [--baseline|--variant] [--previous-response-id]",
    );
    console.error(
      "   or: npm run benchmark:all [--baseline|--variant] [--previous-response-id]",
    );
    console.error("   or: npm run benchmark:experiment");
    console.error("   or: npm run benchmark:eval [-- --previous-response-id]");
    console.error("   or: npm run benchmark:routing");
    console.error("   or: npm run benchmark:planning");
    console.error("   or: npm run benchmark:subagents");
    console.error("   or: npm run benchmark:decomposition");
    console.error("   or: npm run benchmark:orchestration");
    console.error("   or: npm run benchmark -- ISO01");
    console.error("   or: npm run benchmark -- SEC01");
    console.error("   or: npm run benchmark -- R01");
    console.error("   or: npm run benchmark -- REV01");
    process.exit(1);
  }

  const ids = all ? [...TASK_IDS] : [taskId!];
  const results: HarnessRunResult[] = [];

  for (const id of ids) {
    const result = await runBenchmark(id, contextMode, {
      conversationStateMode,
    });
    results.push(result);
  }

  if (results.length > 1) {
    console.log("\n=== Benchmark Summary ===");
    for (const [index, result] of results.entries()) {
      const id = ids[index];
      const expected = isExpectedV1Outcome(id, result)
        ? "expected"
        : "UNEXPECTED";
      console.log(
        `${id}: ${result.workflowStatus} | mode=${result.contextMode} | spec=${result.specDecision?.status ?? "none"} | impl=${result.implementationStarted ? "yes" : "no"} | tests=${result.implementationStarted ? (result.finalVerificationPassed ? "PASS" : "FAIL") : "skipped"} | ${expected} | ${path.basename(result.tracePath)}`,
      );
    }
  }

  const allExpected = results.every((result, index) =>
    isExpectedV1Outcome(ids[index], result),
  );
  process.exit(allExpected ? 0 : 1);
}

const isDirectRun = process.argv[1]?.endsWith("run-benchmark.ts");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
