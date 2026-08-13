import fs from "node:fs";
import path from "node:path";

export type FileSnapshot = Map<string, string>;

export function snapshotDirectory(root: string): FileSnapshot {
  const snapshot: FileSnapshot = new Map();
  walk(root, root, snapshot);
  return snapshot;
}

export function diffSnapshots(
  before: FileSnapshot,
  after: FileSnapshot,
): { changedFiles: string[]; unifiedDiff: string } {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changedFiles: string[] = [];
  const chunks: string[] = [];

  for (const rel of [...paths].sort()) {
    const left = before.get(rel);
    const right = after.get(rel);
    if (left === right) {
      continue;
    }
    changedFiles.push(rel);
    if (left === undefined) {
      chunks.push(`--- /dev/null\n+++ ${rel}\n${prefixLines(right ?? "", "+")}`);
    } else if (right === undefined) {
      chunks.push(`--- ${rel}\n+++ /dev/null\n${prefixLines(left, "-")}`);
    } else {
      chunks.push(simpleUnifiedDiff(rel, left, right));
    }
  }

  return {
    changedFiles,
    unifiedDiff: chunks.join("\n"),
  };
}

function walk(root: string, current: string, snapshot: FileSnapshot): void {
  if (!fs.existsSync(current)) {
    return;
  }
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, absolute, snapshot);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const rel = path.relative(root, absolute).split(path.sep).join("/");
    snapshot.set(rel, fs.readFileSync(absolute, "utf8"));
  }
}

function simpleUnifiedDiff(file: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines = [`--- ${file}`, `+++ ${file}`];

  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i++) {
    const a = beforeLines[i];
    const b = afterLines[i];
    if (a === b) {
      if (a !== undefined) {
        lines.push(` ${a}`);
      }
      continue;
    }
    if (a !== undefined) {
      lines.push(`-${a}`);
    }
    if (b !== undefined) {
      lines.push(`+${b}`);
    }
  }

  return lines.join("\n");
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
