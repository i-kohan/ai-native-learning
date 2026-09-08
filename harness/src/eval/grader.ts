import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnNpmTest, type VerificationResult } from "../verify.ts";

export type IndependentGraderResult = {
  name: string;
  passed: boolean;
  independentOfHarnessVerify: true;
  provenance: "benchmark_owned_independent";
  output: string;
  durationMs: number;
  graderFiles: string[];
  stagingDir: string;
};

export function runIndependentGrader(options: {
  name: string;
  hostGraderDir: string;
  targetAppRoot: string;
}): IndependentGraderResult {
  const graderFiles = listGraderFiles(options.hostGraderDir);
  if (graderFiles.length === 0) {
    throw new Error(`No grader tests found under ${options.hostGraderDir}`);
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "independent-grader-"));
  try {
    copyDir(options.targetAppRoot, stagingDir);
    const testsDir = path.join(stagingDir, "tests");
    fs.mkdirSync(testsDir, { recursive: true });
    for (const file of graderFiles) {
      fs.copyFileSync(file, path.join(testsDir, path.basename(file)));
    }
    linkNodeModules(options.targetAppRoot, stagingDir);

    const started = Date.now();
    const verification = verificationFromNpm(spawnNpmTest(stagingDir), started);
    return {
      name: options.name,
      passed: verification.passed,
      independentOfHarnessVerify: true,
      provenance: "benchmark_owned_independent",
      output: verification.output,
      durationMs: verification.durationMs,
      graderFiles: graderFiles.map((file) => path.basename(file)),
      stagingDir,
    };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function listGraderFiles(graderDir: string): string[] {
  if (!fs.existsSync(graderDir)) {
    return [];
  }
  return fs
    .readdirSync(graderDir)
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => path.join(graderDir, name))
    .sort();
}

export function workspaceContainsGraderFiles(
  targetAppRoot: string,
  graderDir: string,
): boolean {
  const testsDir = path.join(targetAppRoot, "tests");
  if (!fs.existsSync(testsDir)) {
    return false;
  }
  const graderNames = new Set(
    listGraderFiles(graderDir).map((file) => path.basename(file)),
  );
  if (graderNames.size === 0) {
    return false;
  }
  return walkFiles(testsDir).some((file) => graderNames.has(path.basename(file)));
}

function verificationFromNpm(
  result: ReturnType<typeof spawnNpmTest>,
  started: number,
): VerificationResult {
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

function linkNodeModules(fromApp: string, toApp: string): void {
  const dest = path.join(toApp, "node_modules");
  if (fs.existsSync(dest)) {
    return;
  }
  const source = path.join(fromApp, "node_modules");
  if (fs.existsSync(source)) {
    fs.symlinkSync(source, dest, "dir");
  }
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}
