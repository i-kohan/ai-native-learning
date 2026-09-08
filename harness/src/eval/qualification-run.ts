import path from "node:path";
import type { HarnessConfig } from "../config.ts";
import { REPO_ROOT } from "../config.ts";
import type { HarnessRunResult } from "../run.ts";
import { aggregateRuns } from "./aggregate.ts";
import {
  calibrateHoldoutGraders,
  calibrationValidity,
  HOLDOUT_GRADER_CONTRACTS,
  type CalibrationReport,
  type HoldoutGraderId,
} from "./calibrate.ts";
import {
  runIndependentGrader,
  workspaceContainsGraderFiles,
} from "./grader.ts";
import { normalizeRun } from "./normalize.ts";
import { decideQualification, type QualificationDecision } from "./qualify.ts";
import { formatQualificationReport } from "./report.ts";
import {
  QUALIFICATION_SUITE_VERSION,
  type EvalResult,
  type RunMetrics,
} from "./types.ts";
import { writeEvalArtifact } from "./write.ts";

export const QUALIFICATION_PROTOCOL = [
  "T01–T04: one regression run each.",
  "H01: 3 independent trials from the same frozen base fixture/revision.",
  "H02: 3 independent trials from the same frozen base fixture/revision.",
  "Each qualification workspace is created from one baseRevision resolved before the protocol starts.",
  "Every normalized run must preserve that baseRevision and the same configured model identity.",
  "Independent grader runs after the harness terminal outcome and before workspace cleanup.",
].join("\n");

export type HoldoutTrialAttempt = {
  result: HarnessRunResult | null;
  graderPassed: boolean | null;
  graderLeakedIntoWorkspace: boolean;
  error: string | null;
};

export type QualificationDeps = {
  runCapability: (
    taskId: "T01" | "T02" | "T03" | "T04",
  ) => Promise<HarnessRunResult>;
  runHoldout: (
    taskId: HoldoutGraderId,
    trialIndex: number,
  ) => Promise<HoldoutTrialAttempt>;
  scoreCapability: (
    taskId: "T01" | "T02" | "T03" | "T04",
    result: HarnessRunResult,
  ) => boolean;
  configuredModel: string;
  baseRevision: string;
};

export type QualificationResult = {
  suiteVersion: string;
  protocol: string;
  eval: EvalResult;
  decision: QualificationDecision;
  calibration: CalibrationReport;
  invalidTrials: string[];
  report: string;
};

export function scoreHoldoutOutcome(
  result: HarnessRunResult,
  graderPassed: boolean,
): boolean {
  return (
    result.workflowStatus === "success" &&
    result.specDecision?.status === "executable" &&
    result.implementationStarted === true &&
    result.finalVerificationPassed === true &&
    graderPassed
  );
}

export function gradeHoldoutWorkspace(options: {
  taskId: HoldoutGraderId;
  config: HarnessConfig;
}): ReturnType<typeof runIndependentGrader> {
  const contract = HOLDOUT_GRADER_CONTRACTS[options.taskId];
  if (
    workspaceContainsGraderFiles(
      options.config.targetAppRoot,
      contract.graderDir,
    )
  ) {
    throw new Error(
      `${options.taskId}: independent grader files leaked into the Worker workspace`,
    );
  }
  return runIndependentGrader({
    name: contract.name,
    hostGraderDir: contract.graderDir,
    targetAppRoot: options.config.targetAppRoot,
  });
}

export async function runQualificationProtocol(
  deps: QualificationDeps,
): Promise<QualificationResult> {
  const calibration = calibrateHoldoutGraders();
  const metrics: RunMetrics[] = [];
  const invalidTrials: string[] = [];

  for (const taskId of ["T01", "T02", "T03", "T04"] as const) {
    const result = await deps.runCapability(taskId);
    metrics.push(
      normalizeRun({
        taskId,
        runId: path.basename(result.tracePath, ".jsonl"),
        result,
        expectedOutcomeMet: deps.scoreCapability(taskId, result),
        trialIndex: 1,
        trialCount: 1,
        suiteVersion: QUALIFICATION_SUITE_VERSION,
        configuredModel: deps.configuredModel,
      }),
    );
  }

  for (const taskId of ["H01", "H02"] as const) {
    for (let trialIndex = 1; trialIndex <= 3; trialIndex += 1) {
      const attempt = await deps.runHoldout(taskId, trialIndex);
      if (!attempt.result || attempt.graderPassed == null || attempt.error) {
        invalidTrials.push(
          `${taskId} trial ${trialIndex}: ${attempt.error ?? "missing result"}`,
        );
        continue;
      }
      if (attempt.graderLeakedIntoWorkspace) {
        invalidTrials.push(
          `${taskId} trial ${trialIndex}: grader leaked into workspace`,
        );
      }
      metrics.push(
        normalizeRun({
          taskId,
          runId: path.basename(attempt.result.tracePath, ".jsonl"),
          result: attempt.result,
          expectedOutcomeMet: scoreHoldoutOutcome(
            attempt.result,
            attempt.graderPassed,
          ),
          trialIndex,
          trialCount: 3,
          suiteVersion: QUALIFICATION_SUITE_VERSION,
          configuredModel: deps.configuredModel,
          independentGrader: {
            name: HOLDOUT_GRADER_CONTRACTS[taskId].name,
            passed: attempt.graderPassed,
            independentOfHarnessVerify: true,
            provenance: "benchmark_owned_independent",
            output: "",
            durationMs: 0,
            graderFiles: [],
            stagingDir: "",
          },
        }),
      );
    }
  }

  const evalResult = aggregateRuns(metrics, {
    suiteVersion: QUALIFICATION_SUITE_VERSION,
  });
  const decision = decideQualification({
    evalResult,
    calibration: calibrationValidity(calibration),
    configuredModel: deps.configuredModel,
    expectedModel: deps.configuredModel,
    expectedBaseRevision: deps.baseRevision,
    invalidTrials,
  });
  const report = formatQualificationReport(evalResult, decision);
  evalResult.report = report;

  return {
    suiteVersion: QUALIFICATION_SUITE_VERSION,
    protocol: QUALIFICATION_PROTOCOL,
    eval: evalResult,
    decision,
    calibration,
    invalidTrials,
    report,
  };
}

export function writeQualificationArtifact(result: QualificationResult): {
  jsonPath: string;
  reportPath: string;
} {
  return writeEvalArtifact({
    evalsDir: path.join(REPO_ROOT, "evals"),
    result: {
      ...result.eval,
      report: result.report,
    },
  });
}
