import { spawnSync } from "node:child_process";
import path from "node:path";
import type { HarnessConfig } from "../config.ts";
import type { Meta01RegressionTask } from "./policy.ts";

export type RegressionCommandResult = {
  id: Meta01RegressionTask;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  outputTail: string;
};

const COMMANDS: Record<Meta01RegressionTask, { args: string[]; timeoutMs: number }> = {
  tsc: {
    args: ["npx-tsc", "--noEmit", "-p", "tsconfig.json"],
    timeoutMs: 3 * 60 * 1000,
  },
  "npm-test": {
    args: ["npm", "test"],
    timeoutMs: 15 * 60 * 1000,
  },
  ISO01: {
    args: ["npx-tsx", "src/run-benchmark.ts", "ISO01"],
    timeoutMs: 10 * 60 * 1000,
  },
  SEC01: {
    args: ["npx-tsx", "src/run-benchmark.ts", "SEC01"],
    timeoutMs: 10 * 60 * 1000,
  },
  T01: {
    args: ["npx-tsx", "src/run-benchmark.ts", "T01", "--variant"],
    timeoutMs: 25 * 60 * 1000,
  },
  T02: {
    args: ["npx-tsx", "src/run-benchmark.ts", "T02", "--variant"],
    timeoutMs: 25 * 60 * 1000,
  },
  T03: {
    args: ["npx-tsx", "src/run-benchmark.ts", "T03", "--variant"],
    timeoutMs: 25 * 60 * 1000,
  },
  T04: {
    args: ["npx-tsx", "src/run-benchmark.ts", "T04", "--variant"],
    timeoutMs: 25 * 60 * 1000,
  },
  R01: {
    args: ["npx-tsx", "src/run-benchmark.ts", "R01"],
    timeoutMs: 25 * 60 * 1000,
  },
  REV01: {
    args: ["npx-tsx", "src/run-benchmark.ts", "REV01"],
    timeoutMs: 25 * 60 * 1000,
  },
};

export async function runRevisionRegression(options: {
  workspaceRoot: string;
  config: HarnessConfig;
  tasks?: Meta01RegressionTask[];
}): Promise<RegressionCommandResult[]> {
  const tasks = options.tasks ?? (Object.keys(COMMANDS) as Meta01RegressionTask[]);
  const results: RegressionCommandResult[] = [];
  for (const id of tasks) {
    const result = runOne(options.workspaceRoot, options.config, id);
    results.push(result);
    if (!result.passed) {
      break;
    }
  }
  return results;
}

export function regressionPassed(results: RegressionCommandResult[]): boolean {
  return results.every((result) => result.passed);
}

function runOne(
  workspaceRoot: string,
  config: HarnessConfig,
  id: Meta01RegressionTask,
): RegressionCommandResult {
  const command = COMMANDS[id];
  const harnessDir = path.join(workspaceRoot, "harness");
  const binDir = path.join(harnessDir, "node_modules", ".bin");
  const args = command.args.map((arg) =>
    arg === "npx-tsc"
      ? path.join(binDir, "tsc")
      : arg === "npx-tsx"
        ? path.join(binDir, "tsx")
        : arg,
  );
  const started = Date.now();
  console.log(`\nMETA01 regression ${id}`);
  const result = spawnSync(args[0], args.slice(1), {
    cwd: harnessDir,
    encoding: "utf8",
    timeout: command.timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      OPENAI_API_KEY: config.apiKey,
      OPENAI_MODEL: config.model,
      ...(config.repairModel ? { OPENAI_REPAIR_MODEL: config.repairModel } : {}),
    },
  });
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const passed = result.status === 0 && !timedOut;
  console.log(`META01 regression ${id}: ${passed ? "PASS" : "FAIL"}`);
  return {
    id,
    passed,
    exitCode: result.status,
    timedOut,
    durationMs: Date.now() - started,
    outputTail: output.slice(-4000),
  };
}
