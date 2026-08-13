import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, loadConfig } from "./config.ts";
import { printRunResult, runAgentLoop, type AgentRunResult } from "./loop.ts";
import { snapshotDirectory } from "./diff.ts";
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

export async function runBenchmark(taskId: TaskId): Promise<AgentRunResult> {
  const prep = prepareBenchmark(taskId);

  if (taskId !== "T04" && prep.initialTestsPassed) {
    throw new Error(
      `${taskId}: expected initial tests to FAIL after setup, but they passed.`,
    );
  }

  console.log(`\n=== Preparing ${taskId} ===`);
  console.log(`initial_tests: ${prep.initialTestsPassed ? "PASS" : "FAIL"}`);

  const config = loadConfig();
  const beforeSnapshot = snapshotDirectory(config.targetSrcRoot);
  const runId = `${taskId}-${timestamp()}`;

  const result = await runAgentLoop({
    config,
    task: prep.task,
    runId,
    beforeSnapshot,
  });

  printRunResult(result);
  return result;
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

function parseArgs(argv: string[]): { all: boolean; taskId?: TaskId } {
  if (argv.includes("--all")) {
    return { all: true };
  }
  const taskId = argv.find((arg) => TASK_IDS.includes(arg as TaskId)) as
    | TaskId
    | undefined;
  if (!taskId) {
    return { all: false };
  }
  return { all: false, taskId };
}

async function main(): Promise<void> {
  const { all, taskId } = parseArgs(process.argv.slice(2));

  if (!all && !taskId) {
    console.error("Usage: npm run benchmark -- T01|T02|T03|T04");
    console.error("   or: npm run benchmark:all");
    process.exit(1);
  }

  const ids = all ? [...TASK_IDS] : [taskId!];
  const results: AgentRunResult[] = [];

  for (const id of ids) {
    const result = await runBenchmark(id);
    results.push(result);
  }

  if (results.length > 1) {
    console.log("\n=== Benchmark Summary ===");
    for (const [index, result] of results.entries()) {
      const id = ids[index];
      console.log(
        `${id}: ${result.status} | tests=${result.finalVerificationPassed ? "PASS" : "FAIL"} | turns=${result.turns} | tools=${result.toolCalls} | ${path.basename(result.tracePath)}`,
      );
    }
  }

  process.exit(results.every((r) => r.status === "success") ? 0 : 1);
}

const isDirectRun = process.argv[1]?.endsWith("run-benchmark.ts");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
