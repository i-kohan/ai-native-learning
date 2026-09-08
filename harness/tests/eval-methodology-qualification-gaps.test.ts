import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateRuns } from "../src/eval/aggregate.ts";
import { normalizeRun } from "../src/eval/normalize.ts";
import { decideQualification } from "../src/eval/qualify.ts";
import { formatQualificationReport } from "../src/eval/report.ts";
import type { HarnessRunResult } from "../src/run.ts";
import type { RunMetrics } from "../src/eval/types.ts";

const BASE = "abc123qualificationbase";
const MODEL = "gpt-5.6-luna";

function harnessResult(options: {
  taskId: string;
  workflowSuccess?: boolean;
  verifyPassed?: boolean;
  baseRevision?: string;
}): HarnessRunResult {
  const workflowSuccess = options.workflowSuccess ?? true;
  const verifyPassed = options.verifyPassed ?? true;
  const isT04 = options.taskId === "T04";

  return {
    task: options.taskId,
    workflowStatus: isT04
      ? "needs_human_judgment"
      : workflowSuccess
        ? "success"
        : "failed",
    specDecision: isT04
      ? {
          status: "needs_human_judgment",
          spec: {
            goal: "ambiguous",
            requirements: [],
            constraints: [],
            nonGoals: [],
            acceptance: [],
            verification: [],
            ambiguities: [],
          },
          unresolvedQuestions: [],
        }
      : {
          status: "executable",
          spec: {
            goal: "goal",
            requirements: ["r"],
            constraints: [],
            nonGoals: [],
            acceptance: [],
            verification: ["npm test"],
            ambiguities: [],
          },
        },
    unresolvedQuestions: [],
    implementationStarted: !isT04,
    implementation: null,
    specTurns: 1,
    specModelCalls: 1,
    specToolCalls: 0,
    planningEnabled: false,
    subagentsEnabled: false,
    reviewPlan: null,
    reviewUnits: [],
    reviewabilityReportPath: null,
    reviewUnitGateFailed: false,
    stoppedReviewUnitId: null,
    plan: null,
    plannerTurns: 0,
    plannerModelCalls: 0,
    plannerToolCalls: 0,
    plannerDurationMs: 0,
    turns: 1,
    modelCalls: 1,
    toolCalls: 0,
    receivedTerminalResponse: true,
    verificationAttempts: isT04 ? 0 : 1,
    repairAttempts: 0,
    repeatedFailure: false,
    verifications: isT04
      ? []
      : [
          {
            attempt: 1,
            passed: verifyPassed,
            exitCode: verifyPassed ? 0 : 1,
            durationMs: 1,
            normalizedFailure: null,
          },
        ],
    repairs: [],
    reviews: [],
    reviewRepairs: [],
    reviewAttempts: 0,
    reviewRepairAttempts: 0,
    finalReviewerOutcome: null,
    acceptedBlockingFindings: [],
    acceptedNonBlockingFindings: [],
    rejectedFindings: [],
    blockingFalsePositives: [],
    intendedFindingDetected: false,
    repeatedFinding: false,
    finalVerificationPassed: isT04 ? false : verifyPassed,
    finalVerification: null,
    modelFinalResponse: "done",
    changedFiles: isT04 ? [] : ["tasks/task-routes.ts"],
    unifiedDiff: "",
    tracePath: `/tmp/${options.taskId}.jsonl`,
    specPath: `/tmp/${options.taskId}.spec.json`,
    durationMs: 100,
    contextMode: "variant",
    conversationStateMode: "manual",
    clientInputItemsSent: 0,
    clientInputBytesSent: 0,
    contextMetrics: {
      mode: "variant",
      preparation: null,
      specDiscovery: {
        listFilesCalls: 0,
        readFileCalls: 0,
        readFilePaths: [],
        listedPaths: [],
      },
      implDiscovery: null,
      pathOverlap: null,
      implNavCallsBeforeFirstWrite: null,
      tokenUsage: null,
    },
    skillLoads: [],
    workspace: {
      id: options.taskId,
      root: "/tmp/ws",
      baseRevision: options.baseRevision ?? BASE,
      ref: options.baseRevision ?? BASE,
    },
  } as unknown as HarnessRunResult;
}

function capability(taskId: "T01" | "T02" | "T03" | "T04"): RunMetrics {
  return normalizeRun({
    taskId,
    runId: `${taskId}-run`,
    result: harnessResult({ taskId }),
    expectedOutcomeMet: true,
    trialIndex: 1,
    trialCount: 1,
    configuredModel: MODEL,
  });
}

function holdout(options: {
  taskId: "H01" | "H02";
  trial: number;
  workflowSuccess?: boolean;
  verifyPassed?: boolean;
  baseRevision?: string;
  model?: string;
}): RunMetrics {
  const result = harnessResult({
    taskId: options.taskId,
    workflowSuccess: options.workflowSuccess,
    verifyPassed: options.verifyPassed,
    baseRevision: options.baseRevision,
  });
  const graderPassed = true;
  const expectedOutcomeMet =
    result.workflowStatus === "success" &&
    result.specDecision?.status === "executable" &&
    result.implementationStarted === true &&
    result.finalVerificationPassed === true &&
    graderPassed;

  return normalizeRun({
    taskId: options.taskId,
    runId: `${options.taskId}-${options.trial}`,
    result,
    expectedOutcomeMet,
    trialIndex: options.trial,
    trialCount: 3,
    configuredModel: options.model ?? MODEL,
    independentGrader: {
      name: "synthetic independent grader",
      passed: graderPassed,
      independentOfHarnessVerify: true,
      provenance: "benchmark_owned_independent",
      output: "PASS",
      durationMs: 1,
      graderFiles: ["hidden.test.ts"],
      stagingDir: "/tmp/grader",
    },
  });
}

function passingRuns(): RunMetrics[] {
  return [
    capability("T01"),
    capability("T02"),
    capability("T03"),
    capability("T04"),
    ...[1, 2, 3].map((trial) => holdout({ taskId: "H01", trial })),
    ...[1, 2, 3].map((trial) => holdout({ taskId: "H02", trial })),
  ];
}

function decide(runs: RunMetrics[]) {
  return decideQualification({
    evalResult: aggregateRuns(runs, { suiteVersion: "qualification-m15" }),
    calibration: { valid: true, reasons: [] },
    configuredModel: MODEL,
    expectedModel: MODEL,
    expectedBaseRevision: BASE,
  });
}

describe("Module 15 qualification methodology gap fixes", () => {
  it("does not support grader 3/3 when a holdout workflow itself failed", () => {
    const runs = passingRuns();
    const failed = holdout({
      taskId: "H01",
      trial: 2,
      workflowSuccess: false,
      verifyPassed: false,
    });
    const index = runs.findIndex(
      (run) => run.identity.taskId === "H01" && run.identity.trialIndex === 2,
    );
    runs[index] = failed;

    const decision = decide(runs);
    assert.deepEqual(decision.h01IndependentGrader, { met: 3, total: 3 });
    assert.deepEqual(decision.h01ExpectedOutcome, { met: 2, total: 3 });
    assert.equal(decision.claimSupported, false);
    assert.equal(decision.verdict, "unsupported");
    assert.match(decision.reasons.join("\n"), /full expected outcome 2\/3/);
  });

  it("treats mixed baseRevision evidence as inconclusive", () => {
    const runs = passingRuns();
    runs[runs.length - 1].identity.baseRevision = "different-base";

    const decision = decide(runs);
    assert.equal(decision.claimSupported, false);
    assert.equal(decision.verdict, "inconclusive");
    assert.match(decision.reasons.join("\n"), /mixed baseRevision/);
  });

  it("treats mixed configured model evidence as inconclusive", () => {
    const runs = passingRuns();
    runs[runs.length - 1].identity.configuredModel = "different-model";

    const decision = decide(runs);
    assert.equal(decision.claimSupported, false);
    assert.equal(decision.verdict, "inconclusive");
    assert.match(decision.reasons.join("\n"), /mixed configured model/);
  });

  it("uses qualification-specific DEV denominator wording", () => {
    const evalResult = aggregateRuns(passingRuns(), {
      suiteVersion: "qualification-m15",
    });
    const decision = decideQualification({
      evalResult,
      calibration: { valid: true, reasons: [] },
      configuredModel: MODEL,
      expectedModel: MODEL,
      expectedBaseRevision: BASE,
    });
    const report = formatQualificationReport(evalResult, decision);

    assert.match(report, /DEV capability contracts\s+4 \/ 4/);
    assert.doesNotMatch(report, /All fixed benchmark contracts\s+4 \/ 4/);
    assert.match(report, /H01 full expected outcome: 3\/3/);
    assert.match(report, /H02 full expected outcome: 3\/3/);
  });
});
