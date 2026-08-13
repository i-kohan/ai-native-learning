import { spawnSync } from "node:child_process";
import type { HarnessConfig } from "./config.ts";

export type VerificationResult = {
  passed: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
};

export function runFinalVerification(config: HarnessConfig): VerificationResult {
  const started = Date.now();
  const result = spawnSync("npm", ["test"], {
    cwd: config.targetAppRoot,
    encoding: "utf8",
    env: childEnvWithoutTestContext(),
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

  return {
    passed: result.status === 0,
    exitCode: result.status ?? 1,
    output,
    durationMs: Date.now() - started,
  };
}

/** Parent node:test sets NODE_TEST_*; nested runs would skip files otherwise. */
export function childEnvWithoutTestContext(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NODE_TEST")) {
      delete env[key];
    }
  }
  return env;
}
