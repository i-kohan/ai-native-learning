import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { HarnessConfig } from "./config.ts";

export type VerificationResult = {
  passed: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
};

export function runFinalVerification(
  config: HarnessConfig,
): VerificationResult {
  const started = Date.now();
  const result = spawnNpmTest(config.targetAppRoot);
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

/**
 * Shared verification spawn for harness VERIFY and model-facing `run_command`.
 * Both paths must use the same child environment policy.
 */
export function spawnNpmTest(cwd: string): SpawnSyncReturns<string> {
  return spawnSync("npm", ["test"], {
    cwd,
    encoding: "utf8",
    env: verificationChildEnv(),
  });
}

/**
 * Positive allowlist for repository code executed through verification.
 *
 * Classes retained:
 * - process launch: resolve `npm` / `node` / `.bin` shims (`PATH`, Windows CreateProcess vars)
 * - temp dirs: npm / tsx / node:test scratch files
 * - user dirs: npm/node default home/cache locations (not a filesystem sandbox)
 *
 * Unrelated parent secrets (`OPENAI_API_KEY`, canaries, tokens) are dropped by
 * omission, not by a denylist of secret names.
 *
 * `NODE_TEST*` is omitted so nested node:test runs still execute files.
 * `NODE_OPTIONS` / `npm_config_*` are omitted: they are not required to launch
 * `npm test` and can inject extra authority.
 */
export const VERIFICATION_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "ComSpec",
  "TMPDIR",
  "TMP",
  "TEMP",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
] as const;

export function verificationChildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of VERIFICATION_ENV_ALLOWLIST) {
    const value = baseEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
