import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ContextMode } from "./context.ts";
import { REPO_ROOT, loadConfig } from "./config.ts";
import { snapshotDirectory } from "./diff.ts";
import {
  printHarnessResult,
  runV1Harness,
  type HarnessRunResult,
} from "./run.ts";
import { runFinalVerification } from "./verify.ts";

const BENCHMARKS_ROOT = path.join(REPO_ROOT, "benchmarks");
const FIXTURE_SRC = path.join(BENCHMARKS_ROOT, "fixtures", "base-src");
const TARGET_SRC = path.join(REPO_ROOT, "target-app", "src");

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

export function prepareBenchmark(taskId: TaskId): BenchmarkPrepResult {
  restoreFixture();

  const taskDir = path.join(BENCHMARKS_ROOT, taskId);
  const taskPath = path.join(taskDir, "task.md");
  if (!fs.existsSync(taskPath)) {
    throw new Error(`Missing task file: ${taskPath}`);
  }
  const task = fs.readFileSync(taskPath, "utf8").trim();

  const patchPath = path.join(taskDir, "setup.patch");
  if (fs.existsSync(patchPath)) {
    applyPatch(patchPath);
  }

  const verification = runFinalVerification({
    apiKey: "unused",
    model: "unused",
    maxTurns: 0,
    repoRoot: REPO_ROOT,
    targetAppRoot: path.join(REPO_ROOT, "target-app"),
    targetSrcRoot: TARGET_SRC,
    tracesDir: path.join(REPO_ROOT, "traces"),
  });

  return {
    taskId,
    task,
    initialTestsPassed: verification.passed,
    initialTestOutput: verification.output,
  };
}

export async function runBenchmark(
  taskId: TaskId,
  contextMode: ContextMode = "baseline",
): Promise<HarnessRunResult> {
  const prep = prepareBenchmark(taskId);

  if (taskId !== "T04" && prep.initialTestsPassed) {
    throw new Error(
      `${taskId}: expected initial tests to FAIL after setup, but they passed.`,
    );
  }

  console.log(`\n=== Preparing ${taskId} (${contextMode}) ===`);
  console.log(`initial_tests: ${prep.initialTestsPassed ? "PASS" : "FAIL"}`);

  const config = loadConfig();
  const beforeSnapshot = snapshotDirectory(config.targetSrcRoot);
  const runId = `${taskId}-${contextMode}-${timestamp()}`;

  const result = await runV1Harness({
    config,
    task: prep.task,
    runId,
    beforeSnapshot,
    contextMode,
  });

  printHarnessResult(result);
  return result;
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

function restoreFixture(): void {
  fs.rmSync(TARGET_SRC, { recursive: true, force: true });
  fs.mkdirSync(TARGET_SRC, { recursive: true });
  copyDir(FIXTURE_SRC, TARGET_SRC);
}

function applyPatch(patchPath: string): void {
  const result = spawnSync(
    "patch",
    ["-p0", "--batch", "--forward", "-i", patchPath],
    {
      cwd: TARGET_SRC,
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

type CliOptions = {
  all: boolean;
  experiment: boolean;
  taskId?: TaskId;
  contextMode: ContextMode;
};

function parseArgs(argv: string[]): CliOptions {
  const contextMode: ContextMode = argv.includes("--variant")
    ? "variant"
    : "baseline";

  if (argv.includes("--experiment")) {
    return { all: false, experiment: true, contextMode };
  }
  if (argv.includes("--all")) {
    return { all: true, experiment: false, contextMode };
  }
  const taskId = argv.find((arg) => TASK_IDS.includes(arg as TaskId)) as
    | TaskId
    | undefined;
  if (!taskId) {
    return { all: false, experiment: false, contextMode };
  }
  return { all: false, experiment: false, taskId, contextMode };
}

async function main(): Promise<void> {
  const { all, experiment, taskId, contextMode } = parseArgs(
    process.argv.slice(2),
  );

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
      "Usage: npm run benchmark -- T01|T02|T03|T04 [--baseline|--variant]",
    );
    console.error("   or: npm run benchmark:all [--baseline|--variant]");
    console.error("   or: npm run benchmark:experiment");
    process.exit(1);
  }

  const ids = all ? [...TASK_IDS] : [taskId!];
  const results: HarnessRunResult[] = [];

  for (const id of ids) {
    const result = await runBenchmark(id, contextMode);
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
