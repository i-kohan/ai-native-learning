import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { git } from "./git.ts";
import {
  CANDIDATE_EXISTING_FILE,
  CORE_LOOP_FUNCTIONS,
  FORBIDDEN_AUTHORITY_PATTERNS,
  META01_MAX_FILES,
  META01_MAX_NEW_FILES,
  META01_MAX_PATCH_LINES,
  type CoreLoopFunction,
} from "./policy.ts";
import { isCreateOnlyFile } from "./paths.ts";

export type FileLineStat = {
  file: string;
  additions: number;
  deletions: number;
};

export type PatchStats = {
  files: string[];
  additions: number;
  deletions: number;
  perFile: FileLineStat[];
  newModules: string[];
  newFeatureBranches: number;
};

export function collectWorktreePatch(workspaceRoot: string): PatchStats & {
  addedLines: string[];
} {
  const files = new Map<string, { additions: number; deletions: number }>();
  const addedLines: string[] = [];
  const diff = git(workspaceRoot, ["diff", "--numstat", "HEAD"]);
  for (const line of diff.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [addText, delText, file] = line.split("\t");
    if (!file) {
      continue;
    }
    files.set(file, {
      additions: Number(addText) || 0,
      deletions: Number(delText) || 0,
    });
  }
  const untracked = git(workspaceRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const file of untracked) {
    if (file.split("/").includes("node_modules")) {
      continue;
    }
    const absolute = path.join(workspaceRoot, file);
    if (!fs.statSync(absolute).isFile()) {
      continue;
    }
    const text = fs.readFileSync(absolute, "utf8");
    files.set(file, { additions: countLines(text), deletions: 0 });
    addedLines.push(...text.split("\n"));
  }
  const unified = git(workspaceRoot, ["diff", "-U0", "HEAD"]);
  for (const line of unified.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.push(line.slice(1));
    }
  }
  let additions = 0;
  let deletions = 0;
  for (const stats of files.values()) {
    additions += stats.additions;
    deletions += stats.deletions;
  }
  const fileList = [...files.keys()].sort();
  return {
    files: fileList,
    additions,
    deletions,
    perFile: fileList.map((file) => ({
      file,
      additions: files.get(file)?.additions ?? 0,
      deletions: files.get(file)?.deletions ?? 0,
    })),
    newModules: fileList.filter((file) => isCreateOnlyFile(file)),
    newFeatureBranches: countFeatureBranches(addedLines),
    addedLines,
  };
}

export function patchWithinBudget(stats: {
  files: string[];
  additions: number;
  deletions: number;
}): { ok: true } | { ok: false; error: string } {
  if (stats.files.length > META01_MAX_FILES) {
    return {
      ok: false,
      error: `write denied: patch budget exceeded (${stats.files.length} files > ${META01_MAX_FILES})`,
    };
  }
  const newFiles = stats.files.filter((file) => file !== CANDIDATE_EXISTING_FILE);
  if (newFiles.length > META01_MAX_NEW_FILES) {
    return {
      ok: false,
      error: `write denied: patch budget exceeded (${newFiles.length} new files > ${META01_MAX_NEW_FILES})`,
    };
  }
  const total = stats.additions + stats.deletions;
  if (total > META01_MAX_PATCH_LINES) {
    return {
      ok: false,
      error: `write denied: patch budget exceeded (${total} lines > ${META01_MAX_PATCH_LINES})`,
    };
  }
  return { ok: true };
}

export function mutationBoundaryHolds(files: string[]): string[] {
  return files.filter(
    (file) => file !== CANDIDATE_EXISTING_FILE && !isCreateOnlyFile(file),
  );
}

export function findAuthorityExpansions(addedLines: string[]): string[] {
  const findings: string[] = [];
  for (const line of addedLines) {
    for (const rule of FORBIDDEN_AUTHORITY_PATTERNS) {
      if (rule.pattern.test(line)) {
        findings.push(`${rule.id}: ${line.trim().slice(0, 180)}`);
      }
    }
  }
  return findings;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function coreFunctionsTouched(
  beforeSource: string,
  afterSource: string,
): CoreLoopFunction[] {
  return CORE_LOOP_FUNCTIONS.filter((name) => {
    return extractFunction(beforeSource, name) !== extractFunction(afterSource, name);
  });
}

export function extractFunction(source: string, name: string): string | null {
  const matcher = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const found = matcher.exec(source);
  if (!found) {
    return null;
  }
  const brace = source.indexOf("{", found.index);
  if (brace < 0) {
    return null;
  }
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(found.index, index + 1);
      }
    }
  }
  return null;
}

function countFeatureBranches(addedLines: string[]): number {
  return addedLines.filter((line) => {
    return (
      /\b(if|switch)\b/.test(line) &&
      /\b(subagent|mcp|a2a|memory|capability|delegation)\b/i.test(line)
    );
  }).length;
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") {
    return parts.length - 1;
  }
  return parts.length;
}
