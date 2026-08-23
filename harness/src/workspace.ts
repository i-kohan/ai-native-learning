import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { HarnessConfig } from "./config.ts";

export type Workspace = {
  id: string;
  root: string;
  baseRevision: string;
  ref: string;
};

export function resolveBaseRevision(
  hostRepoRoot: string,
  ref = "HEAD",
): string {
  return git(hostRepoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

export function createWorkspace(options: {
  hostRepoRoot: string;
  id: string;
  ref?: string;
}): Workspace {
  const ref = options.ref ?? "HEAD";
  const baseRevision = resolveBaseRevision(options.hostRepoRoot, ref);
  const root = workspacePath(options.hostRepoRoot, options.id);

  if (fs.existsSync(root) || isRegisteredWorktree(options.hostRepoRoot, root)) {
    throw new Error(`Workspace path already exists: ${root}`);
  }

  fs.mkdirSync(path.dirname(root), { recursive: true });
  try {
    git(options.hostRepoRoot, [
      "worktree",
      "add",
      "--detach",
      root,
      baseRevision,
    ]);
    linkTargetAppNodeModules(options.hostRepoRoot, root);
  } catch (error) {
    cleanupWorkspace({ hostRepoRoot: options.hostRepoRoot, root });
    throw error;
  }

  return {
    id: options.id,
    root,
    baseRevision,
    ref,
  };
}

export function cleanupWorkspace(options: {
  hostRepoRoot: string;
  workspace?: Workspace;
  root?: string;
}): void {
  const root = options.root ?? options.workspace?.root;
  if (!root) {
    throw new Error("cleanupWorkspace requires workspace or root");
  }

  const registered = isRegisteredWorktree(options.hostRepoRoot, root);
  if (registered) {
    const removed = spawnSync(
      "git",
      ["worktree", "remove", "--force", root],
      gitSpawn(options.hostRepoRoot),
    );
    if (removed.status !== 0 && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  } else if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
  }

  spawnSync("git", ["worktree", "prune"], gitSpawn(options.hostRepoRoot));
  if (fs.existsSync(root)) {
    fs.rmSync(root, { recursive: true, force: true });
    spawnSync("git", ["worktree", "prune"], gitSpawn(options.hostRepoRoot));
  }
}

export function bindConfig(
  base: HarnessConfig,
  workspace: Workspace,
): HarnessConfig {
  const targetAppRoot = path.join(workspace.root, "target-app");
  return {
    ...base,
    repoRoot: workspace.root,
    targetAppRoot,
    targetSrcRoot: path.join(targetAppRoot, "src"),
  };
}

export function workspacePath(hostRepoRoot: string, id: string): string {
  return path.join(hostRepoRoot, ".worktrees", sanitizeWorkspaceId(id));
}

export function isWorkspacePresent(
  hostRepoRoot: string,
  root: string,
): boolean {
  return fs.existsSync(root) || isRegisteredWorktree(hostRepoRoot, root);
}

export function listRegisteredWorktrees(hostRepoRoot: string): string[] {
  const output = git(hostRepoRoot, ["worktree", "list", "--porcelain"]);
  const roots: string[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      roots.push(path.resolve(line.slice("worktree ".length)));
    }
  }
  return roots;
}

function linkTargetAppNodeModules(
  hostRepoRoot: string,
  workspaceRoot: string,
): void {
  const hostModules = path.join(hostRepoRoot, "target-app", "node_modules");
  const dest = path.join(workspaceRoot, "target-app", "node_modules");
  if (!fs.existsSync(hostModules)) {
    throw new Error(
      `Missing ${hostModules}. Run npm install in target-app before isolated runs.`,
    );
  }
  try {
    fs.lstatSync(dest);
    return;
  } catch {
    fs.symlinkSync(hostModules, dest, "dir");
  }
}

function isRegisteredWorktree(hostRepoRoot: string, root: string): boolean {
  const resolved = path.resolve(root);
  return listRegisteredWorktrees(hostRepoRoot).includes(resolved);
}

function sanitizeWorkspaceId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) {
    throw new Error(`Invalid workspace id: ${id}`);
  }
  return cleaned;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, gitSpawn(cwd));
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function gitSpawn(cwd: string): {
  cwd: string;
  encoding: "utf8";
} {
  return { cwd, encoding: "utf8" };
}
