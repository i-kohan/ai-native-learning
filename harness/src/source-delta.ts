import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWorkspaceHead } from "./workspace.ts";

export const SOURCE_DELTA_FORMAT = "git-binary-full-index" as const;
export const DEFAULT_SOURCE_SURFACE = "target-app/src";

export type SourceDelta = {
  baseRevision: string;
  format: typeof SOURCE_DELTA_FORMAT;
  patch: string;
  changedFiles: string[];
};

export type SourceDeltaApplyResult =
  | {
      ok: true;
      changedFiles: string[];
    }
  | {
      ok: false;
      conflict: true;
      evidence: string;
      changedFiles: string[];
    };

export function captureSourceDelta(options: {
  workspaceRoot: string;
  baseRevision: string;
  sourceSurface?: string;
}): SourceDelta {
  const sourceSurface = options.sourceSurface ?? DEFAULT_SOURCE_SURFACE;
  const indexPath = tempIndexPath();
  const env = isolatedIndexEnv(indexPath);
  try {
    git(options.workspaceRoot, ["read-tree", options.baseRevision], env);
    git(options.workspaceRoot, ["add", "-A", "--", sourceSurface], env);
    const changedFiles = git(
      options.workspaceRoot,
      [
        "diff",
        "--cached",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        options.baseRevision,
        "--",
        sourceSurface,
      ],
      env,
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const patch = git(
      options.workspaceRoot,
      [
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        options.baseRevision,
        "--",
        sourceSurface,
      ],
      env,
    );
    return {
      baseRevision: options.baseRevision,
      format: SOURCE_DELTA_FORMAT,
      patch,
      changedFiles,
    };
  } finally {
    removeTempIndex(indexPath);
  }
}

export function applySourceDelta(options: {
  workspaceRoot: string;
  baseRevision: string;
  delta: SourceDelta;
}): SourceDeltaApplyResult {
  const head = readWorkspaceHead(options.workspaceRoot);
  if (head !== options.baseRevision) {
    return {
      ok: false,
      conflict: true,
      evidence: `integration HEAD ${head} != plan.baseRevision ${options.baseRevision}`,
      changedFiles: [],
    };
  }
  if (options.delta.baseRevision !== options.baseRevision) {
    return {
      ok: false,
      conflict: true,
      evidence: `child baseRevision ${options.delta.baseRevision} != plan.baseRevision ${options.baseRevision}`,
      changedFiles: [],
    };
  }
  if (!options.delta.patch.trim()) {
    return { ok: true, changedFiles: [] };
  }

  syncIndexToWorktree(options.workspaceRoot);

  const patchPath = path.join(
    os.tmpdir(),
    `fanout-delta-${randomBytes(8).toString("hex")}.patch`,
  );
  fs.writeFileSync(patchPath, options.delta.patch);
  try {
    const applied = spawnSync(
      "git",
      ["apply", "--3way", "--whitespace=nowarn", patchPath],
      {
        cwd: options.workspaceRoot,
        encoding: "utf8",
      },
    );
    const output = [applied.stdout ?? "", applied.stderr ?? ""]
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n");
    const conflicted = detectConflict(
      options.workspaceRoot,
      output,
      applied.status,
    );
    if (conflicted) {
      return {
        ok: false,
        conflict: true,
        evidence: output || "git apply --3way failed without output",
        changedFiles: listUncommittedSourceFiles(options.workspaceRoot),
      };
    }
    const afterHead = readWorkspaceHead(options.workspaceRoot);
    if (afterHead !== options.baseRevision) {
      return {
        ok: false,
        conflict: true,
        evidence: `HEAD moved during fan-in: ${afterHead} != ${options.baseRevision}`,
        changedFiles: listUncommittedSourceFiles(options.workspaceRoot),
      };
    }
    return {
      ok: true,
      changedFiles: listUncommittedSourceFiles(options.workspaceRoot),
    };
  } finally {
    fs.rmSync(patchPath, { force: true });
  }
}

function syncIndexToWorktree(
  workspaceRoot: string,
  sourceSurface = DEFAULT_SOURCE_SURFACE,
): void {
  git(workspaceRoot, ["add", "-A", "--", sourceSurface]);
}

export function listUncommittedSourceFiles(
  workspaceRoot: string,
  sourceSurface = DEFAULT_SOURCE_SURFACE,
): string[] {
  const names = git(workspaceRoot, [
    "diff",
    "--name-only",
    "HEAD",
    "--",
    sourceSurface,
  ]);
  const untracked = git(workspaceRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    sourceSurface,
  ]);
  return uniqueSorted(
    [...names.split("\n"), ...untracked.split("\n")]
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function detectConflict(
  workspaceRoot: string,
  output: string,
  status: number | null,
): boolean {
  if (status !== 0) {
    return true;
  }
  const text = output.toLowerCase();
  if (
    text.includes("with conflicts") ||
    text.includes("merge conflict") ||
    text.includes("error: patch failed")
  ) {
    return true;
  }
  return sourceHasConflictMarkers(workspaceRoot);
}

function sourceHasConflictMarkers(workspaceRoot: string): boolean {
  const root = path.join(workspaceRoot, DEFAULT_SOURCE_SURFACE);
  if (!fs.existsSync(root)) {
    return false;
  }
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const text = fs.readFileSync(absolute, "utf8");
      if (
        text.includes("<<<<<<<") ||
        text.includes(">>>>>>>") ||
        text.includes("=======")
      ) {
        return true;
      }
    }
  }
  return false;
}

export function unstageWithoutLosingWork(workspaceRoot: string): void {
  const staged = git(workspaceRoot, ["diff", "--cached", "--name-only"]).trim();
  if (!staged) {
    return;
  }
  git(workspaceRoot, ["reset", "--mixed", "HEAD"]);
}

function isolatedIndexEnv(indexPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
  };
}

function tempIndexPath(): string {
  return path.join(
    os.tmpdir(),
    `fanout-index-${randomBytes(8).toString("hex")}`,
  );
}

function removeTempIndex(indexPath: string): void {
  fs.rmSync(indexPath, { force: true });
  fs.rmSync(`${indexPath}.lock`, { force: true });
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function git(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}
