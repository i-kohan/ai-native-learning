import type { HarnessRunResult, VerificationAttempt } from "../run.ts";
import { isEscalationTask, runIdentity } from "./catalog.ts";
import type {
  EfficiencyMetrics,
  FindingSummary,
  FixedTaskId,
  OutcomeMetrics,
  PhaseEfficiency,
  ProbeMetrics,
  RecoveryMetrics,
  ReviewMetrics,
  RunMetrics,
  VerificationOutcome,
} from "./types.ts";

export function normalizeRun(options: {
  taskId: FixedTaskId;
  runId: string;
  result: HarnessRunResult;
  expectedOutcomeMet: boolean;
}): RunMetrics {
  const { taskId, runId, result, expectedOutcomeMet } = options;
  const identity = runIdentity({ runId, taskId });

  return {
    identity,
    outcome: outcomeMetrics(taskId, result, expectedOutcomeMet),
    recovery: recoveryMetrics(result),
    review: reviewMetrics(result),
    efficiency: efficiencyMetrics(result),
    ...(identity.mechanism
      ? { probe: probeMetrics(taskId, result, expectedOutcomeMet) }
      : {}),
  };
}

function outcomeMetrics(
  taskId: FixedTaskId,
  result: HarnessRunResult,
  expectedOutcomeMet: boolean,
): OutcomeMetrics {
  const humanEscalation =
    result.workflowStatus === "needs_human_judgment" ||
    result.specDecision?.status === "needs_human_judgment";
  const autonomousCompletion =
    result.workflowStatus === "success" &&
    result.implementationStarted &&
    !humanEscalation;

  return {
    expectedOutcomeMet,
    workflowStatus: result.workflowStatus,
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    failureLayer: null,
    autonomousCompletion,
    humanEscalation,
    specDecision: result.specDecision?.status ?? null,
    implementationStarted: result.implementationStarted,
    ...completionMetrics(taskId, result),
    escapedDefect: null,
    grader: {
      name: result.implementationStarted ? "target-app npm test" : "none",
      passed: result.implementationStarted
        ? result.finalVerificationPassed
        : null,
      independentOfHarnessVerify: false,
    },
  };
}

function completionMetrics(
  taskId: FixedTaskId,
  result: HarnessRunResult,
): Pick<
  OutcomeMetrics,
  "firstPassSuccess" | "eventualSuccess" | "recoveredSuccess"
> {
  if (isEscalationTask(taskId)) {
    return {
      firstPassSuccess: null,
      eventualSuccess: null,
      recoveredSuccess: null,
    };
  }

  const harnessRecovery =
    result.repairAttempts > 0 || result.reviewRepairAttempts > 0;
  const eventualSuccess = result.workflowStatus === "success";
  return {
    firstPassSuccess: eventualSuccess && !harnessRecovery,
    eventualSuccess,
    recoveredSuccess: eventualSuccess && harnessRecovery,
  };
}

function recoveryMetrics(result: HarnessRunResult): RecoveryMetrics {
  const verificationSequence = result.verifications.map(verificationOutcome);
  return {
    firstVerificationPassed:
      result.verifications.length > 0 ? result.verifications[0].passed : null,
    verificationAttempts: result.verifications.length,
    verificationSequence,
    verificationRepairAttempts: result.repairAttempts,
    repeatedFailure: result.repeatedFailure,
  };
}

function verificationOutcome(item: VerificationAttempt): VerificationOutcome {
  return item.passed ? "PASS" : "FAIL";
}

function reviewMetrics(result: HarnessRunResult): ReviewMetrics {
  const findings = result.reviews.flatMap((review) =>
    review.decisions.map((record) => ({
      findingKey: record.finding.findingKey,
      category: record.finding.category,
      severity: record.finding.severity,
      decision: record.decision,
      reviewRound: review.round,
      repeatedAfterRepair: findingRepeatedAfterRepair(
        result,
        record.finding.findingKey,
        review.round,
      ),
    })),
  );

  return {
    reviewAttempts: result.reviewAttempts,
    reviewRepairAttempts: result.reviewRepairAttempts,
    repeatedFinding: result.repeatedFinding,
    findingsObserved: findings.length,
    acceptedBlocking: countDecision(findings, "accepted_blocking"),
    acceptedNonBlocking: countDecision(findings, "accepted_non_blocking"),
    rejected: countDecision(findings, "rejected"),
    findings,
  };
}

function findingRepeatedAfterRepair(
  result: HarnessRunResult,
  findingKey: string,
  reviewRound: number,
): boolean {
  if (reviewRound !== 2 || result.reviewRepairAttempts === 0) {
    return false;
  }
  const first = result.reviews.find((review) => review.round === 1);
  return Boolean(
    first?.decisions.some((record) => record.finding.findingKey === findingKey),
  );
}

function countDecision(
  findings: FindingSummary[],
  decision: FindingSummary["decision"],
): number {
  return findings.filter((item) => item.decision === decision).length;
}

function efficiencyMetrics(result: HarnessRunResult): EfficiencyMetrics {
  const usage = result.contextMetrics.tokenUsage;
  const specDiscovery = result.contextMetrics.specDiscovery;
  const implDiscovery = result.contextMetrics.implDiscovery;

  return {
    modelCalls: result.modelCalls,
    toolCalls: result.toolCalls,
    repoDiscoveryToolCalls: {
      list_files:
        specDiscovery.listFilesCalls + (implDiscovery?.listFilesCalls ?? 0),
      read_file:
        specDiscovery.readFileCalls + (implDiscovery?.readFileCalls ?? 0),
    },
    inputTokens: usage?.totalInputTokens ?? null,
    outputTokens: usage?.totalOutputTokens ?? null,
    wallTimeMs: result.durationMs,
    phases: {
      spec: phaseEfficiency({
        modelCalls: result.specModelCalls,
        toolCalls: result.specToolCalls,
        inputTokens: usage?.specInputTokens ?? null,
        outputTokens: usage?.specOutputTokens ?? null,
        wallTimeMs: null,
      }),
      implementation: phaseEfficiency({
        modelCalls: result.implementation?.modelCalls ?? 0,
        toolCalls: result.implementation?.toolCalls ?? 0,
        inputTokens: usage?.implInputTokens ?? null,
        outputTokens: usage?.implOutputTokens ?? null,
        wallTimeMs: result.implementation?.durationMs ?? null,
      }),
      verification: {
        attempts: result.verifications.length,
        wallTimeMs: result.verifications.reduce(
          (sum, item) => sum + item.durationMs,
          0,
        ),
      },
      repair: summedEpisode(
        result.repairs,
        usage?.repairInputTokens ?? null,
        usage?.repairOutputTokens ?? null,
      ),
      review: summedEpisode(
        result.reviews,
        usage?.reviewInputTokens ?? null,
        usage?.reviewOutputTokens ?? null,
      ),
      review_repair: summedEpisode(
        result.reviewRepairs,
        usage?.reviewRepairInputTokens ?? null,
        usage?.reviewRepairOutputTokens ?? null,
      ),
    },
  };
}

function phaseEfficiency(fields: PhaseEfficiency): PhaseEfficiency {
  return fields;
}

function summedEpisode(
  episodes: Array<{
    modelCalls: number;
    toolCalls: number;
    durationMs: number;
  }>,
  inputTokens: number | null,
  outputTokens: number | null,
): PhaseEfficiency {
  return {
    modelCalls: episodes.reduce((sum, item) => sum + item.modelCalls, 0),
    toolCalls: episodes.reduce((sum, item) => sum + item.toolCalls, 0),
    inputTokens,
    outputTokens,
    wallTimeMs: episodes.length
      ? episodes.reduce((sum, item) => sum + item.durationMs, 0)
      : null,
  };
}

function probeMetrics(
  taskId: FixedTaskId,
  result: HarnessRunResult,
  expectedOutcomeMet: boolean,
): ProbeMetrics {
  if (taskId === "R01") {
    return {
      mechanism: "verification_repair",
      succeeded: expectedOutcomeMet,
      controlledFailureTriggered: result.verifications[0]?.passed === false,
    };
  }

  return {
    mechanism: "independent_review_repair",
    succeeded: expectedOutcomeMet,
    intendedFindingDetected: result.intendedFindingDetected,
    unexpectedBlockingFindings: result.blockingFalsePositives.length,
  };
}
