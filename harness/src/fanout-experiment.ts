import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.ts";
import {
  bindFanOutPlanFromTemplates,
  type FanOutSchedule,
  type FanOutUnitTemplate,
  type ParseFanOutPlanResult,
} from "./fan-out-plan.ts";
import type { FanOutEvidence } from "./fan-out.ts";
import type { HarnessRunResult } from "./run.ts";
import type { Spec } from "./spec.ts";

export const FANOUT_EXPERIMENT_ID = "m22-p03-par01-fanout";
export const FANOUT_TASK_ID = "P03";
export const FANOUT_CONTEXT_MODE = "variant" as const;
export const FANOUT_CONVERSATION_STATE_MODE = "manual" as const;
export const FANOUT_TRIALS_PER_ARM = 3;
export const PAR01_WALL_TIME_IMPROVEMENT = 0.2;
export const PAR01_COST_REGRESSION = 0.2;

export type FanOutArmId = FanOutSchedule;

export const PAR01_DECISION_RULE = [
  "PAR01 predefined decision rule (frozen before any final trials):",
  "PAR01 is supported only if:",
  "1. correctness is preserved in every valid trial;",
  "2. all child VERIFY gates, deterministic fan-in, final VERIFY, and independent REVIEW succeed;",
  "3. there are no unresolved integration conflicts or lost changes;",
  "4. median full end-to-end wall time of parallel is at least 20% lower than sequential;",
  "5. available median cost metrics do not materially regress by more than 20%.",
  "The 20% threshold is a practical precommitted material-difference threshold, not a universal law.",
  "Full trial wall clock starts before workspace setup and runs through final VERIFY + independent REVIEW.",
  "Do not manufacture a positive conclusion merely because the child execution interval became shorter.",
  "Allowed conclusions: supported | not_worth_current_workload | inconclusive.",
  "Default architecture remains Spec → one Worker. Fan-out is an experiment/probe layer only.",
].join("\n");

const P03_INTEGRATION_ORDER = ["A", "B"];

export const P03_FAN_OUT_UNIT_TEMPLATES: FanOutUnitTemplate[] = [
  {
    id: "A",
    intent:
      "Add PATCH /tasks/:id/title: trim a non-empty title, 400 on invalid/missing title, 404 on unknown task.",
    verificationIntent: [
      "Existing tests still pass",
      "Title mutation success, validation, and 404 pass",
    ],
    testFiles: ["tests/title-mutation.test.ts"],
  },
  {
    id: "B",
    intent:
      "Add DELETE /tasks/:id: return the deleted task, subsequent GET is 404, unknown task is 404.",
    verificationIntent: [
      "Existing tests still pass",
      "Deletion success, subsequent GET 404, and unknown 404 pass",
    ],
    testFiles: ["tests/task-deletion.test.ts"],
  },
];

export function bindP03FanOutPlan(
  spec: Spec,
  baseRevision: string,
): ParseFanOutPlanResult {
  return bindFanOutPlanFromTemplates(
    spec,
    baseRevision,
    P03_FAN_OUT_UNIT_TEMPLATES,
    P03_INTEGRATION_ORDER,
  );
}

export type FanOutTrialValidityReason =
  | "valid"
  | "run_error"
  | "fixture_not_applied";

export type FanOutTrialValidity = {
  valid: boolean;
  reason: FanOutTrialValidityReason;
  detail?: string;
};

export type FanOutChildMetrics = {
  unitId: string;
  durationMs: number;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  changedFiles: string[];
  verificationPassed: boolean;
  repairAttempts: number;
};

export type FanOutTrialMetrics = {
  expectedOutcomeMet: boolean;
  workflowStatus: HarnessRunResult["workflowStatus"];
  finalVerification: "PASS" | "FAIL" | "skipped";
  finalReviewerOutcome: HarnessRunResult["finalReviewerOutcome"];
  childVerificationPassed: boolean;
  fanInOk: boolean;
  integrationConflicts: boolean;
  lostChanges: string[];
  writeSetOverlap: string[];
  childChangedFiles: Record<string, string[]>;
  finalChangedFiles: string[];
  verificationRepairAttempts: number;
  reviewRepairAttempts: number;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number;
  childADurationMs: number | null;
  childBDurationMs: number | null;
  childDurationSumMs: number;
  childIntervalMs: number;
  fanInDurationMs: number;
  finalGateDurationMs: number | null;
  children: FanOutChildMetrics[];
  schedule: FanOutSchedule | null;
};

export type FanOutTrialRecord = {
  arm: FanOutArmId;
  attempt: number;
  valid: boolean;
  validity: FanOutTrialValidity;
  runId: string | null;
  tracePath: string | null;
  metrics: FanOutTrialMetrics | null;
};

export type FanOutArmMedians = {
  wallTimeMs: number | null;
  modelCalls: number | null;
  toolCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  childIntervalMs: number | null;
};

export type FanOutArmReport = {
  id: FanOutArmId;
  label: string;
  schedule: FanOutSchedule;
  attemptedTrials: number;
  validTrials: number;
  expectedMet: number;
  correctnessPreserved: number;
  trials: FanOutTrialRecord[];
  contaminated: FanOutTrialRecord[];
  medians: FanOutArmMedians;
};

export type FanOutConclusion =
  | "supported"
  | "not_worth_current_workload"
  | "inconclusive";

export type FanOutDecision = {
  correctnessPreserved: boolean;
  gatesSucceeded: boolean;
  noConflictsOrLostChanges: boolean;
  wallTimeImproved: boolean;
  costRegressed: boolean;
  childIntervalShorter: boolean;
  conclusion: FanOutConclusion;
  defaultUnchanged: true;
  notes: string[];
};

export type FanOutExperimentResult = {
  experimentId: string;
  generatedAt: string;
  taskId: typeof FANOUT_TASK_ID;
  contextMode: typeof FANOUT_CONTEXT_MODE;
  conversationStateMode: typeof FANOUT_CONVERSATION_STATE_MODE;
  hypothesis: string;
  decisionRule: string;
  sequential: FanOutArmReport;
  parallel: FanOutArmReport;
  decision: FanOutDecision;
  report: string;
};

export type FanOutProbeAttempt = {
  fixtureApplied: boolean;
  result: HarnessRunResult | null;
  error: string | null;
  trialWallTimeMs: number | null;
};

export type FanOutExperimentDeps = {
  runTrial: (arm: FanOutArmId, runId: string) => Promise<FanOutProbeAttempt>;
  scoreExpected: (result: HarnessRunResult) => boolean;
};

const HYPOTHESIS =
  "A frozen two-unit FanOutPlan over genuinely independent P03 work can reduce full end-to-end wall time when scheduled in parallel, without changing product semantics, ReviewPlan, delivery, or the default Spec → one Worker architecture.";

export function isExpectedP03Outcome(result: HarnessRunResult): boolean {
  const fanOut = result.fanOut;
  return (
    result.workflowStatus === "success" &&
    result.specDecision?.status === "executable" &&
    result.implementationStarted === true &&
    result.finalVerificationPassed === true &&
    result.finalReviewerOutcome === "pass" &&
    fanOut?.ok === true &&
    fanOut.children.every((child) => child.verificationPassed) &&
    fanOut.fanIn.ok &&
    fanOut.fanIn.conflict === null &&
    fanOut.fanIn.lostChanges.length === 0
  );
}

export function assessFanOutTrialValidity(options: {
  fixtureApplied: boolean;
  error: string | null;
  result: HarnessRunResult | null;
}): FanOutTrialValidity {
  if (!options.fixtureApplied) {
    return {
      valid: false,
      reason: "fixture_not_applied",
      ...(options.error ? { detail: options.error } : {}),
    };
  }
  if (options.error || !options.result) {
    return {
      valid: false,
      reason: "run_error",
      ...(options.error ? { detail: options.error } : {}),
    };
  }
  return { valid: true, reason: "valid" };
}

export async function runFanOutExperiment(
  deps: FanOutExperimentDeps,
): Promise<FanOutExperimentResult> {
  const generatedAt = new Date().toISOString();
  const sequential = await collectArm(deps, "sequential");
  const parallel = await collectArm(deps, "parallel");
  const result: FanOutExperimentResult = {
    experimentId: FANOUT_EXPERIMENT_ID,
    generatedAt,
    taskId: FANOUT_TASK_ID,
    contextMode: FANOUT_CONTEXT_MODE,
    conversationStateMode: FANOUT_CONVERSATION_STATE_MODE,
    hypothesis: HYPOTHESIS,
    decisionRule: PAR01_DECISION_RULE,
    sequential,
    parallel,
    decision: evaluatePar01Decision(sequential, parallel),
    report: "",
  };
  result.report = formatFanOutReport(result);
  return result;
}

export function writeFanOutExperimentArtifact(result: FanOutExperimentResult): {
  jsonPath: string;
  reportPath: string;
} {
  const stamp = result.generatedAt.replace(/[:.]/g, "-");
  const evalsDir = path.join(REPO_ROOT, "evals");
  fs.mkdirSync(evalsDir, { recursive: true });
  const jsonName = `fanout-m22-par01-${stamp}.json`;
  const reportName = `fanout-m22-par01-${stamp}.txt`;
  const jsonPath = path.join(evalsDir, jsonName);
  const reportPath = path.join(evalsDir, reportName);
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${result.report}\n`);
  return { jsonPath, reportPath };
}

export function evaluatePar01Decision(
  sequential: FanOutArmReport,
  parallel: FanOutArmReport,
): FanOutDecision {
  const notes: string[] = [];
  if (sequential.validTrials < FANOUT_TRIALS_PER_ARM) {
    notes.push(
      `sequential valid trials ${sequential.validTrials}/${FANOUT_TRIALS_PER_ARM}`,
    );
  }
  if (parallel.validTrials < FANOUT_TRIALS_PER_ARM) {
    notes.push(
      `parallel valid trials ${parallel.validTrials}/${FANOUT_TRIALS_PER_ARM}`,
    );
  }

  const enoughTrials =
    sequential.validTrials === FANOUT_TRIALS_PER_ARM &&
    parallel.validTrials === FANOUT_TRIALS_PER_ARM;
  const correctnessPreserved =
    enoughTrials &&
    sequential.correctnessPreserved === sequential.validTrials &&
    parallel.correctnessPreserved === parallel.validTrials;
  const gatesSucceeded = correctnessPreserved;
  const noConflictsOrLostChanges =
    enoughTrials && allTrialsClean(sequential) && allTrialsClean(parallel);
  const wallTimeImproved = medianImprovedBy(
    sequential.medians.wallTimeMs,
    parallel.medians.wallTimeMs,
    PAR01_WALL_TIME_IMPROVEMENT,
  );
  const costRegressed = costMateriallyRegressed(sequential, parallel);
  const childIntervalShorter = medianImprovedBy(
    sequential.medians.childIntervalMs,
    parallel.medians.childIntervalMs,
    PAR01_WALL_TIME_IMPROVEMENT,
  );

  let conclusion: FanOutConclusion = "inconclusive";
  if (!enoughTrials) {
    conclusion = "inconclusive";
    notes.push("Not enough valid trials for a PAR01 decision.");
  } else if (!correctnessPreserved || !noConflictsOrLostChanges) {
    conclusion = "not_worth_current_workload";
    notes.push(
      "Correctness, child/final gates, or deterministic integration was not preserved on every valid trial.",
    );
  } else if (costRegressed) {
    conclusion = "not_worth_current_workload";
    notes.push("Available median cost metrics regressed by more than 20%.");
  } else if (!wallTimeImproved) {
    conclusion = "not_worth_current_workload";
    notes.push(
      "Parallel median full end-to-end wall time was not at least 20% lower than sequential.",
    );
    if (childIntervalShorter) {
      notes.push(
        "Child execution interval was shorter; that is not enough to support PAR01.",
      );
    }
  } else {
    conclusion = "supported";
    notes.push(
      "Correctness preserved and parallel median e2e wall time improved by at least 20% without a material cost regression.",
    );
  }

  return {
    correctnessPreserved,
    gatesSucceeded,
    noConflictsOrLostChanges,
    wallTimeImproved,
    costRegressed,
    childIntervalShorter,
    conclusion,
    defaultUnchanged: true,
    notes,
  };
}

export function metricsFromP03Run(
  result: HarnessRunResult,
  expectedOutcomeMet: boolean,
  trialWallTimeMs?: number,
): FanOutTrialMetrics {
  const fanOut = result.fanOut;
  const childA = fanOut?.children.find((item) => item.unitId === "A");
  const childB = fanOut?.children.find((item) => item.unitId === "B");
  const wallTimeMs = trialWallTimeMs ?? result.durationMs;
  return {
    expectedOutcomeMet,
    workflowStatus: result.workflowStatus,
    finalVerification: result.implementationStarted
      ? result.finalVerificationPassed
        ? "PASS"
        : "FAIL"
      : "skipped",
    finalReviewerOutcome: result.finalReviewerOutcome,
    childVerificationPassed:
      fanOut?.children.every((item) => item.verificationPassed) ?? false,
    fanInOk: fanOut?.fanIn.ok ?? false,
    integrationConflicts: Boolean(fanOut?.fanIn.conflict),
    lostChanges: fanOut?.fanIn.lostChanges ?? [],
    writeSetOverlap: fanOut?.writeSetOverlap ?? [],
    childChangedFiles: Object.fromEntries(
      (fanOut?.children ?? []).map((item) => [item.unitId, item.changedFiles]),
    ),
    finalChangedFiles: result.changedFiles,
    verificationRepairAttempts: result.repairAttempts,
    reviewRepairAttempts: result.reviewRepairAttempts,
    modelCalls: result.modelCalls,
    toolCalls: result.toolCalls,
    inputTokens: result.contextMetrics.tokenUsage?.totalInputTokens ?? null,
    outputTokens: result.contextMetrics.tokenUsage?.totalOutputTokens ?? null,
    wallTimeMs,
    childADurationMs: childA?.durationMs ?? null,
    childBDurationMs: childB?.durationMs ?? null,
    childDurationSumMs: fanOut?.childDurationSumMs ?? 0,
    childIntervalMs: fanOut?.childIntervalMs ?? 0,
    fanInDurationMs: fanOut?.fanIn.durationMs ?? 0,
    finalGateDurationMs: finalGateDuration(result, fanOut, wallTimeMs),
    children: (fanOut?.children ?? []).map(childMetrics),
    schedule: fanOut?.schedule ?? null,
  };
}

async function collectArm(
  deps: FanOutExperimentDeps,
  arm: FanOutArmId,
): Promise<FanOutArmReport> {
  const trials: FanOutTrialRecord[] = [];
  const contaminated: FanOutTrialRecord[] = [];
  let attempt = 0;
  while (
    trials.length < FANOUT_TRIALS_PER_ARM &&
    attempt < FANOUT_TRIALS_PER_ARM + 2
  ) {
    attempt += 1;
    const runId = `P03-fanout-${arm}-${attempt}-${timestamp()}`;
    const probe = await deps.runTrial(arm, runId);
    const validity = assessFanOutTrialValidity(probe);
    const metrics =
      probe.result && validity.valid
        ? metricsFromP03Run(
            probe.result,
            deps.scoreExpected(probe.result),
            probe.trialWallTimeMs ?? undefined,
          )
        : null;
    const record: FanOutTrialRecord = {
      arm,
      attempt,
      valid: validity.valid,
      validity,
      runId: probe.result ? runId : null,
      tracePath: probe.result?.tracePath ?? null,
      metrics,
    };
    if (validity.valid) {
      trials.push(record);
    } else {
      contaminated.push(record);
    }
  }

  const validMetrics = trials
    .map((item) => item.metrics)
    .filter((item): item is FanOutTrialMetrics => item !== null);

  return {
    id: arm,
    label: arm === "sequential" ? "SEQUENTIAL A → B" : "PARALLEL A || B",
    schedule: arm,
    attemptedTrials: attempt,
    validTrials: trials.length,
    expectedMet: validMetrics.filter((item) => item.expectedOutcomeMet).length,
    correctnessPreserved: validMetrics.filter((item) => trialCorrect(item))
      .length,
    trials,
    contaminated,
    medians: {
      wallTimeMs: median(validMetrics.map((item) => item.wallTimeMs)),
      modelCalls: median(validMetrics.map((item) => item.modelCalls)),
      toolCalls: median(validMetrics.map((item) => item.toolCalls)),
      inputTokens: median(validMetrics.map((item) => item.inputTokens)),
      outputTokens: median(validMetrics.map((item) => item.outputTokens)),
      childIntervalMs: median(validMetrics.map((item) => item.childIntervalMs)),
    },
  };
}

function trialCorrect(metrics: FanOutTrialMetrics): boolean {
  return (
    metrics.expectedOutcomeMet &&
    metrics.childVerificationPassed &&
    metrics.fanInOk &&
    !metrics.integrationConflicts &&
    metrics.lostChanges.length === 0 &&
    metrics.finalVerification === "PASS" &&
    metrics.finalReviewerOutcome === "pass"
  );
}

function allTrialsClean(arm: FanOutArmReport): boolean {
  return arm.trials.every(
    (trial) =>
      trial.metrics &&
      trial.metrics.fanInOk &&
      !trial.metrics.integrationConflicts &&
      trial.metrics.lostChanges.length === 0,
  );
}

function costMateriallyRegressed(
  sequential: FanOutArmReport,
  parallel: FanOutArmReport,
): boolean {
  const keys: Array<keyof FanOutArmMedians> = [
    "modelCalls",
    "toolCalls",
    "inputTokens",
    "outputTokens",
  ];
  return keys.some((key) => {
    const left = sequential.medians[key];
    const right = parallel.medians[key];
    if (left === null || right === null || left === 0) {
      return false;
    }
    return right > left * (1 + PAR01_COST_REGRESSION);
  });
}

function medianImprovedBy(
  baseline: number | null,
  variant: number | null,
  threshold: number,
): boolean {
  if (baseline === null || variant === null || baseline <= 0) {
    return false;
  }
  return variant <= baseline * (1 - threshold);
}

function finalGateDuration(
  result: HarnessRunResult,
  fanOut: FanOutEvidence | null | undefined,
  wallTimeMs: number,
): number | null {
  if (!fanOut) {
    return null;
  }
  const childEnd = Math.max(
    0,
    ...fanOut.children.map((item) => item.finishedAt),
  );
  if (childEnd === 0) {
    return null;
  }
  const remaining =
    wallTimeMs - fanOut.childIntervalMs - fanOut.fanIn.durationMs;
  return remaining >= 0 ? remaining : result.durationMs;
}

function childMetrics(
  child: FanOutEvidence["children"][number],
): FanOutChildMetrics {
  return {
    unitId: child.unitId,
    durationMs: child.durationMs,
    modelCalls: child.modelCalls,
    toolCalls: child.toolCalls,
    inputTokens: child.tokenUsage?.totalInputTokens ?? null,
    outputTokens: child.tokenUsage?.totalOutputTokens ?? null,
    changedFiles: child.changedFiles,
    verificationPassed: child.verificationPassed,
    repairAttempts: child.repairAttempts,
  };
}

function formatFanOutReport(result: FanOutExperimentResult): string {
  return [
    `Experiment ${result.experimentId}`,
    `task: ${result.taskId}`,
    `generated: ${result.generatedAt}`,
    `contextMode: ${result.contextMode}`,
    `conversationStateMode: ${result.conversationStateMode}`,
    "",
    result.hypothesis,
    "",
    result.decisionRule,
    "",
    formatArm(result.sequential),
    "",
    formatArm(result.parallel),
    "",
    `decision.correctnessPreserved: ${result.decision.correctnessPreserved}`,
    `decision.gatesSucceeded: ${result.decision.gatesSucceeded}`,
    `decision.noConflictsOrLostChanges: ${result.decision.noConflictsOrLostChanges}`,
    `decision.wallTimeImproved: ${result.decision.wallTimeImproved}`,
    `decision.costRegressed: ${result.decision.costRegressed}`,
    `decision.childIntervalShorter: ${result.decision.childIntervalShorter}`,
    `decision.conclusion: ${result.decision.conclusion}`,
    "decision.defaultUnchanged: true",
    ...result.decision.notes.map((note) => `- ${note}`),
  ].join("\n");
}

function formatArm(arm: FanOutArmReport): string {
  const lines = [
    `## ${arm.label}`,
    `valid: ${arm.validTrials}/${arm.attemptedTrials}`,
    `expected: ${arm.expectedMet}/${arm.validTrials}`,
    `correctness: ${arm.correctnessPreserved}/${arm.validTrials}`,
    `median wall: ${fmtNum(arm.medians.wallTimeMs)}ms`,
    `median model/tools: ${fmtNum(arm.medians.modelCalls)} / ${fmtNum(arm.medians.toolCalls)}`,
    `median tokens in/out: ${fmtNum(arm.medians.inputTokens)} / ${fmtNum(arm.medians.outputTokens)}`,
    `median child interval: ${fmtNum(arm.medians.childIntervalMs)}ms`,
  ];
  for (const trial of arm.trials) {
    if (!trial.metrics) {
      continue;
    }
    lines.push(
      `trial ${trial.attempt}: expected=${trial.metrics.expectedOutcomeMet} verify=${trial.metrics.finalVerification} review=${trial.metrics.finalReviewerOutcome} wall=${trial.metrics.wallTimeMs} childInterval=${trial.metrics.childIntervalMs} overlap=${trial.metrics.writeSetOverlap.join(",") || "(none)"} conflict=${trial.metrics.integrationConflicts}`,
    );
  }
  return lines.join("\n");
}

function median(values: Array<number | null>): number | null {
  const present = values
    .filter((item): item is number => item !== null)
    .sort((left, right) => left - right);
  if (present.length === 0) {
    return null;
  }
  const mid = Math.floor(present.length / 2);
  if (present.length % 2 === 0) {
    return Math.round((present[mid - 1] + present[mid]) / 2);
  }
  return present[mid];
}

function fmtNum(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : String(value);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
