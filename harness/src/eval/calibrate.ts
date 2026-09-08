import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "../config.ts";
import { spawnNpmTest } from "../verify.ts";
import {
  listGraderFiles,
  runIndependentGrader,
  type IndependentGraderResult,
} from "./grader.ts";
import type { CalibrationValidity } from "./qualify.ts";

export const HOLDOUT_GRADER_CONTRACTS = {
  H01: {
    taskId: "H01",
    name: "H01 independent grader",
    graderDir: path.join(REPO_ROOT, "benchmarks", "H01", "grader"),
    calibrationDir: path.join(REPO_ROOT, "benchmarks", "H01", "calibration"),
  },
  H02: {
    taskId: "H02",
    name: "H02 independent grader",
    graderDir: path.join(REPO_ROOT, "benchmarks", "H02", "grader"),
    calibrationDir: path.join(REPO_ROOT, "benchmarks", "H02", "calibration"),
  },
} as const;

export type HoldoutGraderId = keyof typeof HOLDOUT_GRADER_CONTRACTS;

export type CalibrationCaseResult = {
  taskId: string;
  caseId: string;
  expected: "PASS" | "FAIL";
  grader: IndependentGraderResult;
  fixtureTestsPassed: boolean;
  stableRerunPassed: boolean | null;
};

export type CalibrationReport = {
  valid: boolean;
  reasons: string[];
  cases: CalibrationCaseResult[];
};

export function calibrateHoldoutGraders(
  ids: HoldoutGraderId[] = ["H01", "H02"],
): CalibrationReport {
  const cases: CalibrationCaseResult[] = [];
  const reasons: string[] = [];

  for (const id of ids) {
    const contract = HOLDOUT_GRADER_CONTRACTS[id];
    if (listGraderFiles(contract.graderDir).length === 0) {
      reasons.push(`${id}: missing grader tests`);
      continue;
    }
    const caseDirs = listCalibrationCases(contract.calibrationDir);
    const correct = caseDirs.filter((item) => item.expected === "PASS");
    const defective = caseDirs.filter((item) => item.expected === "FAIL");
    if (correct.length === 0) {
      reasons.push(`${id}: missing known-correct calibration case`);
    }
    if (defective.length === 0) {
      reasons.push(`${id}: missing known-defective calibration case`);
    }
    for (const item of caseDirs) {
      cases.push(runCalibrationCase(id, item));
    }
  }

  for (const item of cases) {
    const passed = item.grader.passed;
    if (item.expected === "PASS" && !passed) {
      reasons.push(
        `${item.taskId}/${item.caseId}: expected PASS, grader FAILed`,
      );
    }
    if (item.expected === "FAIL" && passed) {
      reasons.push(
        `${item.taskId}/${item.caseId}: expected FAIL, grader PASSed`,
      );
    }
    if (item.expected === "PASS" && item.stableRerunPassed === false) {
      reasons.push(`${item.taskId}/${item.caseId}: grader rerun was not stable`);
    }
    if (item.expected === "PASS" && !item.fixtureTestsPassed) {
      reasons.push(
        `${item.taskId}/${item.caseId}: known-correct implementation broke fixture tests`,
      );
    }
  }

  return {
    valid: reasons.length === 0 && cases.length > 0,
    reasons,
    cases,
  };
}

export function calibrationValidity(
  report: CalibrationReport,
): CalibrationValidity {
  return { valid: report.valid, reasons: report.reasons };
}

function runCalibrationCase(
  taskId: HoldoutGraderId,
  item: { caseId: string; expected: "PASS" | "FAIL"; dir: string },
): CalibrationCaseResult {
  const contract = HOLDOUT_GRADER_CONTRACTS[taskId];
  const appRoot = materializeCalibrationApp(item.dir);
  try {
    const fixture = spawnNpmTest(appRoot);
    const grader = runIndependentGrader({
      name: contract.name,
      hostGraderDir: contract.graderDir,
      targetAppRoot: appRoot,
    });
    let stableRerunPassed: boolean | null = null;
    if (item.expected === "PASS") {
      const rerun = runIndependentGrader({
        name: contract.name,
        hostGraderDir: contract.graderDir,
        targetAppRoot: appRoot,
      });
      stableRerunPassed = rerun.passed === grader.passed;
    }
    return {
      taskId,
      caseId: item.caseId,
      expected: item.expected,
      grader,
      fixtureTestsPassed: fixture.status === 0,
      stableRerunPassed,
    };
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
}

function listCalibrationCases(calibrationDir: string): Array<{
  caseId: string;
  expected: "PASS" | "FAIL";
  dir: string;
}> {
  const cases: Array<{
    caseId: string;
    expected: "PASS" | "FAIL";
    dir: string;
  }> = [];
  const correctDir = path.join(calibrationDir, "correct");
  const defectsDir = path.join(calibrationDir, "defects");
  if (fs.existsSync(correctDir)) {
    for (const name of fs.readdirSync(correctDir).sort()) {
      const dir = path.join(correctDir, name);
      if (fs.statSync(dir).isDirectory()) {
        cases.push({ caseId: `correct/${name}`, expected: "PASS", dir });
      }
    }
  }
  if (fs.existsSync(defectsDir)) {
    for (const name of fs.readdirSync(defectsDir).sort()) {
      const dir = path.join(defectsDir, name);
      if (fs.statSync(dir).isDirectory()) {
        cases.push({ caseId: `defects/${name}`, expected: "FAIL", dir });
      }
    }
  }
  return cases;
}

function materializeCalibrationApp(caseDir: string): string {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "grader-calibration-"));
  const fixtureSrc = path.join(REPO_ROOT, "benchmarks", "fixtures", "base-src");
  const hostApp = path.join(REPO_ROOT, "target-app");
  fs.mkdirSync(path.join(appRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(appRoot, "tests"), { recursive: true });
  copyDir(fixtureSrc, path.join(appRoot, "src"));
  overlayDir(path.join(caseDir, "src"), path.join(appRoot, "src"));
  copyDir(path.join(hostApp, "tests"), path.join(appRoot, "tests"));
  fs.copyFileSync(
    path.join(hostApp, "package.json"),
    path.join(appRoot, "package.json"),
  );
  const hostModules = path.join(hostApp, "node_modules");
  if (fs.existsSync(hostModules)) {
    fs.symlinkSync(hostModules, path.join(appRoot, "node_modules"), "dir");
  }
  return appRoot;
}

function overlayDir(from: string, to: string): void {
  if (!fs.existsSync(from)) {
    throw new Error(`Missing calibration overlay: ${from}`);
  }
  copyDir(from, to);
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}
