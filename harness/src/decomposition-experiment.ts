import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.ts";
import {
  bindReviewPlanFromTemplates,
  diffLineCount,
  type ChangeUnitTemplate,
  type ParseReviewPlanResult,
  type ReviewUnitReport,
} from "./review-plan.ts";
import type { HarnessRunResult } from "./run.ts";
import type { Spec } from "./spec.ts";

export const DECOMPOSITION_EXPERIMENT_ID = "m14-p02-review-decomposition";
export const DECOMPOSITION_TASK_ID = "P02";
export const DECOMPOSITION_CONTEXT_MODE = "variant" as const;
export const DECOMPOSITION_CONVERSATION_STATE_MODE = "manual" as const;
export const DECOMPOSITION_TRIALS_PER_ARM = 3;

export type DecompositionArmId = "baseline" | "variant";

export const PREDEFINED_DECISION_RULE = [
  "Predefined decision rule (encoded before the experiment):",
  "1. Decomposition is useful only if correctness is preserved.",
  "2. Actual units must be materially easier for a human to understand/review than the final unified diff. Topic Chat supplies that human-review signal; do not invent an LLM review score.",
  "3. Boundaries must be semantic rather than file-based.",
  "4. Dependencies must be explicit.",
  "5. Intermediate states must remain valid.",
  "6. No Spec acceptance criteria may be lost.",
  "7. Decomposition/integration overhead must not erase the human-review benefit.",
  "8. If Variant quality is worse than Baseline: reject.",
  "9. If intermediate unit verification fails or acceptance coverage is lost: reject.",
  "10. single_change remains a first-class valid outcome. P01 remains the negative example: a split can be imagined, but the workload is too small/cohesive for extra review boundaries.",
  "11. Do not auto-adopt. Default stays Spec → one Worker until Topic Chat accepts a human-review benefit that survives the overhead.",
].join("\n");

const P02_RATIONALE =
  "Split due dates into capability, mutation, and overdue querying so a human can review semantic units instead of one mixed final diff. Advisory only; Spec remains authority.";

export const P02_REVIEW_UNIT_TEMPLATES: ChangeUnitTemplate[] = [
  {
    id: "A",
    intent:
      "Establish due-date capability: Task.dueAt, create/default/validation, and complete/reopen preserve dueAt.",
    dependsOn: [],
    verificationIntent: [
      "Existing tests still pass",
      "Create/default/invalid dueAt and complete/reopen preservation pass",
    ],
    testFiles: ["tests/due-date-capability.test.ts"],
    score: (acceptance) =>
      keywordScore(acceptance, [
        "dueat",
        "post /tasks",
        "creat",
        "default",
        "missing",
        "preserve",
        "complete",
        "reopen",
      ]),
  },
  {
    id: "B",
    intent:
      "Allow due-date mutation: PATCH set/clear, validation, and 404 for unknown tasks.",
    dependsOn: ["A"],
    verificationIntent: [
      "Existing tests and unit A still pass",
      "PATCH set/clear/invalid/404 pass",
    ],
    testFiles: ["tests/due-date-mutation.test.ts"],
    score: (acceptance) =>
      keywordScore(acceptance, [
        "patch",
        "due-date",
        "clear",
        "404",
        "unknown",
        "update",
        "mutat",
      ]),
  },
  {
    id: "C",
    intent:
      "Add overdue querying: due=overdue, completed excluded, composition with status.",
    dependsOn: ["A"],
    verificationIntent: [
      "Existing tests and prior units still pass",
      "Overdue filtering, completed exclusion, and status composition pass",
    ],
    testFiles: ["tests/due-overdue.test.ts"],
    score: (acceptance) =>
      keywordScore(acceptance, [
        "overdue",
        "due=",
        "due query",
        "compos",
        "status",
        "completed",
        "filter",
      ]),
  },
];

export function bindP02ReviewPlan(spec: Spec): ParseReviewPlanResult {
  return bindReviewPlanFromTemplates(
    spec,
    P02_REVIEW_UNIT_TEMPLATES,
    P02_RATIONALE,
  );
}

export type DecompositionTrialValidityReason =
  | "valid"
  | "run_error"
  | "fixture_not_applied";

export type DecompositionTrialValidity = {
  valid: boolean;
  reason: DecompositionTrialValidityReason;
  detail?: string;
};

export type DecompositionUnitMetrics = {
  id: string;
  intent: string;
  acceptanceRefs: string[];
  dependsOn: string[];
  changedFiles: string[];
  diffLines: number;
  verificationPassed: boolean;
  repairAttempts: number;
  modelCalls: number;
  toolCalls: number;
  deviation: string | null;
};

export type DecompositionTrialMetrics = {
  expectedOutcomeMet: boolean;
  workflowStatus: HarnessRunResult["workflowStatus"];
  finalVerification: "PASS" | "FAIL" | "skipped";
  firstVerification: "PASS" | "FAIL" | "missing";
  verificationRepairAttempts: number;
  reviewRepairAttempts: number;
  acceptedBlockingFindings: number;
  changedFiles: string[];
  finalDiffLines: number;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number;
  reviewPlanDecision: string | null;
  unitCount: number;
  units: DecompositionUnitMetrics[];
  intermediateValid: boolean;
  emptyUnitDiffs: number;
  reviewabilityReportPath: string | null;
};

export type DecompositionTrialRecord = {
  arm: DecompositionArmId;
  attempt: number;
  valid: boolean;
  validity: DecompositionTrialValidity;
  runId: string | null;
  tracePath: string | null;
  metrics: DecompositionTrialMetrics | null;
};

export type DecompositionArmAverages = {
  modelCalls: number | null;
  toolCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number | null;
  finalDiffLines: number | null;
  verificationRepairAttempts: number | null;
  reviewRepairAttempts: number | null;
};

export type DecompositionArmReport = {
  id: DecompositionArmId;
  label: string;
  decomposed: boolean;
  attemptedTrials: number;
  validTrials: number;
  expectedMet: number;
  firstVerificationPass: number;
  intermediateValid: number;
  trials: DecompositionTrialRecord[];
  contaminated: DecompositionTrialRecord[];
  averages: DecompositionArmAverages;
};

export type DecompositionQualityComparison =
  | "variant_worse"
  | "variant_better"
  | "equal"
  | "noisy";

export type DecompositionEfficiencyComparison =
  | "variant_better"
  | "variant_worse"
  | "equal"
  | "noisy";

export type DecompositionConclusion = "reject" | "candidate" | "inconclusive";

export type DecompositionDecision = {
  quality: DecompositionQualityComparison;
  efficiency: DecompositionEfficiencyComparison;
  intermediateValid: boolean;
  conclusion: DecompositionConclusion;
  defaultUnchanged: true;
  notes: string[];
};

export type DecompositionExperimentResult = {
  experimentId: string;
  generatedAt: string;
  taskId: typeof DECOMPOSITION_TASK_ID;
  contextMode: typeof DECOMPOSITION_CONTEXT_MODE;
  conversationStateMode: typeof DECOMPOSITION_CONVERSATION_STATE_MODE;
  hypothesis: string;
  decisionRule: string;
  baseline: DecompositionArmReport;
  variant: DecompositionArmReport;
  decision: DecompositionDecision;
  report: string;
};

export type DecompositionProbeAttempt = {
  fixtureApplied: boolean;
  result: HarnessRunResult | null;
  error: string | null;
};

export type DecompositionExperimentDeps = {
  runTrial: (
    arm: DecompositionArmId,
    runId: string,
  ) => Promise<DecompositionProbeAttempt>;
  scoreExpected: (result: HarnessRunResult) => boolean;
};

const HYPOTHESIS =
  "A manual advisory ReviewPlan that yields real sequential semantic unit diffs can improve human reviewability of a larger feature without becoming Spec, without parallel workers, and without becoming the default architecture.";

export function isExpectedP02Outcome(result: HarnessRunResult): boolean {
  return (
    result.workflowStatus === "success" &&
    result.specDecision?.status === "executable" &&
    result.implementationStarted === true &&
    result.finalVerificationPassed === true
  );
}

export function assessDecompositionTrialValidity(options: {
  fixtureApplied: boolean;
  error: string | null;
  result: HarnessRunResult | null;
}): DecompositionTrialValidity {
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

export async function runDecompositionExperiment(
  deps: DecompositionExperimentDeps,
): Promise<DecompositionExperimentResult> {
  const generatedAt = new Date().toISOString();
  const baseline = await collectArm(deps, "baseline");
  const variant = await collectArm(deps, "variant");
  const result: DecompositionExperimentResult = {
    experimentId: DECOMPOSITION_EXPERIMENT_ID,
    generatedAt,
    taskId: DECOMPOSITION_TASK_ID,
    contextMode: DECOMPOSITION_CONTEXT_MODE,
    conversationStateMode: DECOMPOSITION_CONVERSATION_STATE_MODE,
    hypothesis: HYPOTHESIS,
    decisionRule: PREDEFINED_DECISION_RULE,
    baseline,
    variant,
    decision: evaluateDecompositionDecision(baseline, variant),
    report: "",
  };
  result.report = formatDecompositionReport(result);
  return result;
}

export function writeDecompositionExperimentArtifact(
  result: DecompositionExperimentResult,
): { jsonPath: string; reportPath: string; lessonDir: string } {
  const stamp = result.generatedAt.replace(/[:.]/g, "-");
  const evalsDir = path.join(REPO_ROOT, "evals");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/14-human-reviewable-decomposition/traces",
  );
  fs.mkdirSync(evalsDir, { recursive: true });
  fs.mkdirSync(lessonDir, { recursive: true });

  const jsonName = `decomposition-m14-${stamp}.json`;
  const reportName = `decomposition-m14-${stamp}.txt`;
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  const report = `${result.report}\n`;

  const jsonPath = path.join(evalsDir, jsonName);
  const reportPath = path.join(evalsDir, reportName);
  fs.writeFileSync(jsonPath, payload);
  fs.writeFileSync(reportPath, report);
  fs.writeFileSync(path.join(lessonDir, jsonName), payload);
  fs.writeFileSync(path.join(lessonDir, reportName), report);
  copyTrialTraces(result, lessonDir);
  return { jsonPath, reportPath, lessonDir };
}

export function evaluateDecompositionDecision(
  baseline: DecompositionArmReport,
  variant: DecompositionArmReport,
): DecompositionDecision {
  const notes: string[] = [];
  if (baseline.validTrials < DECOMPOSITION_TRIALS_PER_ARM) {
    notes.push(
      `baseline valid trials ${baseline.validTrials}/${DECOMPOSITION_TRIALS_PER_ARM}`,
    );
  }
  if (variant.validTrials < DECOMPOSITION_TRIALS_PER_ARM) {
    notes.push(
      `variant valid trials ${variant.validTrials}/${DECOMPOSITION_TRIALS_PER_ARM}`,
    );
  }

  const quality = compareQuality(baseline, variant);
  const efficiency = compareEfficiency(baseline, variant);
  const intermediateValid =
    variant.validTrials === 0
      ? false
      : variant.intermediateValid === variant.validTrials;

  if (!intermediateValid) {
    notes.push("variant intermediate unit verification was not always valid");
  }

  let conclusion: DecompositionConclusion = "inconclusive";
  if (quality === "variant_worse" || !intermediateValid) {
    conclusion = "reject";
  } else if (quality === "noisy") {
    conclusion = "inconclusive";
  } else {
    notes.push(
      "Human reviewability is not auto-scored. Topic Chat owns that signal. Default remains single_change / one Worker.",
    );
    conclusion = efficiency === "variant_worse" ? "reject" : "inconclusive";
  }

  return {
    quality,
    efficiency,
    intermediateValid,
    conclusion,
    defaultUnchanged: true,
    notes,
  };
}

export function metricsFromP02Run(
  result: HarnessRunResult,
  expectedOutcomeMet: boolean,
): DecompositionTrialMetrics {
  const first = result.verifications[0];
  return {
    expectedOutcomeMet,
    workflowStatus: result.workflowStatus,
    finalVerification: result.implementationStarted
      ? result.finalVerificationPassed
        ? "PASS"
        : "FAIL"
      : "skipped",
    firstVerification: first
      ? first.passed
        ? "PASS"
        : "FAIL"
      : "missing",
    verificationRepairAttempts: result.repairAttempts,
    reviewRepairAttempts: result.reviewRepairAttempts,
    acceptedBlockingFindings: result.acceptedBlockingFindings.length,
    changedFiles: result.changedFiles,
    finalDiffLines: diffLineCount(result.unifiedDiff),
    modelCalls: result.modelCalls,
    toolCalls: result.toolCalls,
    inputTokens: result.contextMetrics.tokenUsage?.totalInputTokens ?? null,
    outputTokens: result.contextMetrics.tokenUsage?.totalOutputTokens ?? null,
    wallTimeMs: result.durationMs,
    reviewPlanDecision: result.reviewPlan?.decision ?? null,
    unitCount: result.reviewUnits.length,
    units: result.reviewUnits.map(unitMetrics),
    intermediateValid:
      result.reviewUnits.length === 0
        ? true
        : result.reviewUnits.every((unit) => unit.verificationPassed),
    emptyUnitDiffs: result.reviewUnits.filter(
      (unit) => unit.changedFiles.length === 0,
    ).length,
    reviewabilityReportPath: result.reviewabilityReportPath,
  };
}

async function collectArm(
  deps: DecompositionExperimentDeps,
  arm: DecompositionArmId,
): Promise<DecompositionArmReport> {
  const trials: DecompositionTrialRecord[] = [];
  const contaminated: DecompositionTrialRecord[] = [];
  let attempt = 0;
  while (
    trials.length < DECOMPOSITION_TRIALS_PER_ARM &&
    attempt < DECOMPOSITION_TRIALS_PER_ARM + 2
  ) {
    attempt += 1;
    const runId = `P02-decomp-${arm}-${attempt}-${timestamp()}`;
    const probe = await deps.runTrial(arm, runId);
    const validity = assessDecompositionTrialValidity(probe);
    const metrics =
      probe.result && validity.valid
        ? metricsFromP02Run(
            probe.result,
            deps.scoreExpected(probe.result),
          )
        : null;
    const record: DecompositionTrialRecord = {
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
    .filter((item): item is DecompositionTrialMetrics => item !== null);

  return {
    id: arm,
    label: arm === "baseline" ? "BASELINE one Worker" : "VARIANT ReviewPlan units",
    decomposed: arm === "variant",
    attemptedTrials: attempt,
    validTrials: trials.length,
    expectedMet: validMetrics.filter((item) => item.expectedOutcomeMet).length,
    firstVerificationPass: validMetrics.filter(
      (item) => item.firstVerification === "PASS",
    ).length,
    intermediateValid: validMetrics.filter((item) => item.intermediateValid)
      .length,
    trials,
    contaminated,
    averages: {
      modelCalls: mean(validMetrics.map((item) => item.modelCalls)),
      toolCalls: mean(validMetrics.map((item) => item.toolCalls)),
      inputTokens: mean(validMetrics.map((item) => item.inputTokens)),
      outputTokens: mean(validMetrics.map((item) => item.outputTokens)),
      wallTimeMs: mean(validMetrics.map((item) => item.wallTimeMs)),
      finalDiffLines: mean(validMetrics.map((item) => item.finalDiffLines)),
      verificationRepairAttempts: mean(
        validMetrics.map((item) => item.verificationRepairAttempts),
      ),
      reviewRepairAttempts: mean(
        validMetrics.map((item) => item.reviewRepairAttempts),
      ),
    },
  };
}

function compareQuality(
  baseline: DecompositionArmReport,
  variant: DecompositionArmReport,
): DecompositionQualityComparison {
  if (
    baseline.validTrials < DECOMPOSITION_TRIALS_PER_ARM ||
    variant.validTrials < DECOMPOSITION_TRIALS_PER_ARM
  ) {
    return "noisy";
  }
  if (variant.expectedMet < baseline.expectedMet) {
    return "variant_worse";
  }
  if (variant.expectedMet > baseline.expectedMet) {
    return "variant_better";
  }
  return "equal";
}

function compareEfficiency(
  baseline: DecompositionArmReport,
  variant: DecompositionArmReport,
): DecompositionEfficiencyComparison {
  const keys: Array<keyof DecompositionArmAverages> = [
    "modelCalls",
    "toolCalls",
    "inputTokens",
    "outputTokens",
    "wallTimeMs",
  ];
  let better = 0;
  let worse = 0;
  for (const key of keys) {
    const left = baseline.averages[key];
    const right = variant.averages[key];
    if (left === null || right === null) {
      continue;
    }
    if (right < left) {
      better += 1;
    } else if (right > left) {
      worse += 1;
    }
  }
  if (better > 0 && worse > 0) {
    return "noisy";
  }
  if (worse > 0) {
    return "variant_worse";
  }
  if (better > 0) {
    return "variant_better";
  }
  return "equal";
}

function formatDecompositionReport(result: DecompositionExperimentResult): string {
  const lines = [
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
    formatArm(result.baseline),
    "",
    formatArm(result.variant),
    "",
    `decision.quality: ${result.decision.quality}`,
    `decision.efficiency: ${result.decision.efficiency}`,
    `decision.intermediateValid: ${result.decision.intermediateValid}`,
    `decision.conclusion: ${result.decision.conclusion}`,
    "decision.defaultUnchanged: true",
    ...result.decision.notes.map((note) => `- ${note}`),
  ];
  return lines.join("\n");
}

function formatArm(arm: DecompositionArmReport): string {
  const lines = [
    `## ${arm.label}`,
    `valid: ${arm.validTrials}/${arm.attemptedTrials}`,
    `expected: ${arm.expectedMet}/${arm.validTrials}`,
    `first VERIFY PASS: ${arm.firstVerificationPass}/${arm.validTrials}`,
    `intermediate valid: ${arm.intermediateValid}/${arm.validTrials}`,
    `avg model/tools: ${fmtNum(arm.averages.modelCalls)} / ${fmtNum(arm.averages.toolCalls)}`,
    `avg tokens in/out: ${fmtNum(arm.averages.inputTokens)} / ${fmtNum(arm.averages.outputTokens)}`,
    `avg wall: ${fmtNum(arm.averages.wallTimeMs)}ms`,
    `avg final diff lines: ${fmtNum(arm.averages.finalDiffLines)}`,
  ];
  for (const trial of arm.trials) {
    if (!trial.metrics) {
      continue;
    }
    lines.push(
      `trial ${trial.attempt}: expected=${trial.metrics.expectedOutcomeMet} verify=${trial.metrics.finalVerification} calls=${trial.metrics.modelCalls} tools=${trial.metrics.toolCalls} units=${trial.metrics.unitCount} emptyDiffs=${trial.metrics.emptyUnitDiffs}`,
    );
    for (const unit of trial.metrics.units) {
      lines.push(
        `  ${unit.id}: files=${unit.changedFiles.join(",") || "(none)"} lines=${unit.diffLines} verify=${unit.verificationPassed ? "PASS" : "FAIL"} dependsOn=${unit.dependsOn.join(",") || "-"} deviation=${unit.deviation ?? "none"}`,
      );
    }
  }
  return lines.join("\n");
}

function unitMetrics(unit: ReviewUnitReport): DecompositionUnitMetrics {
  return {
    id: unit.id,
    intent: unit.intent,
    acceptanceRefs: unit.acceptanceRefs,
    dependsOn: unit.dependsOn,
    changedFiles: unit.changedFiles,
    diffLines: diffLineCount(unit.unifiedDiff),
    verificationPassed: unit.verificationPassed,
    repairAttempts: unit.repairAttempts,
    modelCalls: unit.modelCalls,
    toolCalls: unit.toolCalls,
    deviation: unit.deviation,
  };
}

function copyTrialTraces(
  result: DecompositionExperimentResult,
  lessonDir: string,
): void {
  const records = [
    ...result.baseline.trials,
    ...result.baseline.contaminated,
    ...result.variant.trials,
    ...result.variant.contaminated,
  ];
  for (const trial of records) {
    if (!trial.tracePath || !fs.existsSync(trial.tracePath)) {
      continue;
    }
    const name = path.basename(trial.tracePath);
    fs.copyFileSync(trial.tracePath, path.join(lessonDir, name));
    const specPath = trial.tracePath.replace(/\.jsonl$/, ".spec.json");
    if (fs.existsSync(specPath)) {
      fs.copyFileSync(specPath, path.join(lessonDir, path.basename(specPath)));
    }
    const reviewPath = trial.tracePath.replace(/\.jsonl$/, ".review-units.md");
    if (fs.existsSync(reviewPath)) {
      fs.copyFileSync(
        reviewPath,
        path.join(lessonDir, path.basename(reviewPath)),
      );
    }
  }
}

function keywordScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce(
    (sum, keyword) => sum + (lower.includes(keyword) ? 1 : 0),
    0,
  );
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((item): item is number => item !== null);
  if (!present.length) {
    return null;
  }
  return Math.round(
    present.reduce((sum, item) => sum + item, 0) / present.length,
  );
}

function fmtNum(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : String(value);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
