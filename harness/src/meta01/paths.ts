import fs from "node:fs";
import path from "node:path";
import { PathAccessError, resolveWithin, toRepoRelative } from "../paths.ts";
import { tryGit } from "./git.ts";
import {
  CANDIDATE_CREATE_DIR,
  CANDIDATE_EXISTING_FILE,
  META01_READ_FILES,
} from "./policy.ts";

const NEW_FILE_NAME = /^[A-Za-z][A-Za-z0-9-]*\.ts$/;

const MAINTENANCE_READ_DENY = [
  "harness/src/eval/",
  "harness/src/meta01/",
  "harness/src/run-benchmark.ts",
  "harness/src/sec01.ts",
  "harness/src/iso01.ts",
];

const MAINTENANCE_WRITE_DENY = [
  ...MAINTENANCE_READ_DENY,
  "harness/src/retry.ts",
  "harness/src/model-routing.ts",
  "harness/src/config.ts",
  "harness/src/run.ts",
  "harness/src/tools.ts",
  "harness/src/verify.ts",
  "harness/src/review.ts",
  "harness/src/review-phase.ts",
  "harness/src/repair.ts",
  "harness/tests/",
];

export function candidateWritePath(
  workspaceRoot: string,
  relativePath: string,
): { ok: true; absolute: string; relative: string } | { ok: false; error: string } {
  const located = locate(workspaceRoot, relativePath);
  if (!located.ok) {
    return located;
  }
  if (located.relative === CANDIDATE_EXISTING_FILE) {
    return located;
  }
  if (!isCreateOnlyFile(located.relative)) {
    return {
      ok: false,
      error: "write denied: path is outside the candidate mutation boundary",
    };
  }
  if (existedAtHead(workspaceRoot, located.relative)) {
    return {
      ok: false,
      error: "write denied: only loop.ts may overwrite an existing file",
    };
  }
  return located;
}

export function candidateReadPath(
  workspaceRoot: string,
  relativePath: string,
): { ok: true; absolute: string; relative: string } | { ok: false; error: string } {
  const located = locate(workspaceRoot, relativePath);
  if (!located.ok) {
    return located;
  }
  if (
    (META01_READ_FILES as readonly string[]).includes(located.relative) ||
    isCreateOnlyFile(located.relative)
  ) {
    return located;
  }
  return { ok: false, error: "read denied: path is outside the candidate read scope" };
}

export function maintenanceReadPath(
  workspaceRoot: string,
  relativePath: string,
): { ok: true; absolute: string; relative: string } | { ok: false; error: string } {
  const located = locate(workspaceRoot, relativePath);
  if (!located.ok) {
    return located;
  }
  if (!located.relative.startsWith("harness/src/") || !located.relative.endsWith(".ts")) {
    return { ok: false, error: "read denied: maintenance reads stay inside harness/src TypeScript" };
  }
  if (isDenied(located.relative, MAINTENANCE_READ_DENY) || mentionsHidden(located.relative)) {
    return { ok: false, error: "read denied: path is outside maintenance read scope" };
  }
  return located;
}

export function maintenanceWritePath(
  workspaceRoot: string,
  relativePath: string,
): { ok: true; absolute: string; relative: string } | { ok: false; error: string } {
  const located = locate(workspaceRoot, relativePath);
  if (!located.ok) {
    return located;
  }
  if (!located.relative.startsWith("harness/src/") || !located.relative.endsWith(".ts")) {
    return {
      ok: false,
      error: "write denied: maintenance writes stay inside harness/src TypeScript",
    };
  }
  if (isDenied(located.relative, MAINTENANCE_WRITE_DENY) || mentionsHidden(located.relative)) {
    return {
      ok: false,
      error: "write denied: tests, eval, security, benchmark, and control plane are closed",
    };
  }
  return located;
}

export function isCreateOnlyFile(relativePath: string): boolean {
  const prefix = `${CANDIDATE_CREATE_DIR}/`;
  if (!relativePath.startsWith(prefix)) {
    return false;
  }
  const name = relativePath.slice(prefix.length);
  return NEW_FILE_NAME.test(name);
}

function locate(
  workspaceRoot: string,
  relativePath: string,
): { ok: true; absolute: string; relative: string } | { ok: false; error: string } {
  let absolute: string;
  try {
    absolute = resolveWithin(workspaceRoot, relativePath);
  } catch (error) {
    if (error instanceof PathAccessError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
  const relative = toRepoRelative(workspaceRoot, absolute);
  if (!staysInside(workspaceRoot, absolute)) {
    return { ok: false, error: "write denied: path escapes the isolated workspace" };
  }
  return { ok: true, absolute, relative };
}

function staysInside(workspaceRoot: string, absolute: string): boolean {
  const root = fs.realpathSync(workspaceRoot);
  const pending: string[] = [];
  let current = absolute;
  while (!fs.existsSync(current)) {
    pending.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
  const realBase = fs.realpathSync(current);
  const realFile = path.resolve(realBase, ...pending);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return realFile === root || realFile.startsWith(prefix);
}

function existedAtHead(workspaceRoot: string, relativePath: string): boolean {
  return tryGit(workspaceRoot, ["cat-file", "-e", `HEAD:${relativePath}`]).ok;
}

function isDenied(relativePath: string, deny: string[]): boolean {
  return deny.some((entry) =>
    entry.endsWith("/") ? relativePath.startsWith(entry) : relativePath === entry,
  );
}

function mentionsHidden(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return (
    lower.includes("grader") ||
    lower.includes("probe") ||
    lower.includes("benchmark") ||
    lower.includes("holdout")
  );
}
