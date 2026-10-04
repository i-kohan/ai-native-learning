import { spawnSync } from "node:child_process";

export function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

export function tryGit(
  cwd: string,
  args: string[],
): { ok: true; stdout: string } | { ok: false; detail: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      detail: `${result.stderr ?? ""}${result.stdout ?? ""}`.trim(),
    };
  }
  return { ok: true, stdout: result.stdout };
}
