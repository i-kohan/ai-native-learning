import fs from "node:fs";
import path from "node:path";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  type Workspace,
} from "../workspace.ts";
import { REPO_ROOT, type HarnessConfig } from "../config.ts";

export function createExactWorkspace(options: {
  hostRepoRoot?: string;
  id: string;
  ref: string;
}): Workspace {
  const hostRepoRoot = options.hostRepoRoot ?? REPO_ROOT;
  const workspace = createWorkspace({
    hostRepoRoot,
    id: options.id,
    ref: options.ref,
  });
  linkHarnessNodeModules(hostRepoRoot, workspace.root);
  return workspace;
}

export function removeWorkspace(workspace: Workspace, hostRepoRoot = REPO_ROOT): void {
  cleanupWorkspace({ hostRepoRoot, workspace });
}

export function bindWorkspace(config: HarnessConfig, workspace: Workspace): HarnessConfig {
  return bindConfig(config, workspace);
}

function linkHarnessNodeModules(hostRepoRoot: string, workspaceRoot: string): void {
  const hostModules = path.join(hostRepoRoot, "harness", "node_modules");
  const dest = path.join(workspaceRoot, "harness", "node_modules");
  if (!fs.existsSync(hostModules)) {
    throw new Error(`Missing ${hostModules}. Install harness dependencies before META01.`);
  }
  if (!fs.existsSync(dest)) {
    fs.symlinkSync(hostModules, dest, "dir");
  }
}
