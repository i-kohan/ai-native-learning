import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.ts";
import { planDeviation, plannedLikelyFiles, type Plan } from "./plan.ts";
import type { HarnessRunResult } from "./run.ts";

export const PLANNING_EXPERIMENT_ID = "m12-p01-planner";
export const PLANNING_TASK_ID = "P01";
export const PLANNING_CONTEXT_MODE = "variant" as const;
export const PLANNING_CONVERSATION_STATE_MODE = "manual" as const;
export const PLANNING_TRIALS_PER_ARM = 3;

export type PlanningArmId = "baseline" | "variant";

export const PREDEFINED_DECISION_RULE = [
  "Predefined decision rule (encoded before the experiment):",
  "1. If Variant has worse correctness/reliability than Baseline: reject explicit Planner.",
  "2. If Variant shows a clear reliability / first-pass-quality improvement (for example fewer failures/repairs or higher expected-outcome success): Planner becomes an adoption candidate even with modest extra overhead.",
  "3. If quality is effectively equal: adopt Planner only if there is a meaningful END-TO-END efficiency improvement and no meaningful regression in tokens/latency/model calls. Worker-only discovery reduction is not sufficient.",
  "4. If quality is equal and Variant costs more end-to-end: reject Planner.",
  "5. If 3-trial evidence is noisy / conflicting: conclusion = inconclusive. Do not invent post-hoc numeric thresholds.",
  "Equal-quality operationalization: no numeric meaningful-efficiency threshold was predefined, so do not emit candidate from directional e2e improvement alone. Clear e2e regression → reject. Conflicting e2e signals → inconclusive. Directionally better e2e without a predefined meaningful threshold → inconclusive, not candidate. Compare model calls, tool calls, input tokens, output tokens, and wall time.",
].join("\n");

export type PlanningTrialValidityReason =
  | "valid"
  | "run_error"
  | "fixture_not_applied";

export type PlanningTrialValidity = {
  valid: boolean;
  reason: PlanningTrialValidityReason;
  detail?: string;
};

export type PlanningTrialMetrics = {
  expectedOutcomeMet: boolean;
  workflowStatus: HarnessRunResult["workflowStatus"];
  finalVerification: "PASS" | "FAIL" | "skipped";
  firstVerification: "PASS" | "FAIL" | "missing";
  verificationRepairAttempts: number;
  reviewRepairAttempts: number;
  acceptedBlockingFindings: number;
  changedFiles: string[];
  modelCalls: number;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number;
  plannerModelCalls: number;
  plannerToolCalls: number;
  plannerInputTokens: number | null;
  plannerOutputTokens: number | null;
  plannerWallTimeMs: number;
  workerModelCalls: number;
  workerToolCalls: number;
  plannedLikelyFiles: string[];
  actualChangedFiles: string[];
  extraChangedFiles: string[];
  unusedLikelyFiles: string[];
  planningEnabled: boolean;
  planAccepted: boolean;
};

export type PlanningTrialRecord = {
  arm: PlanningArmId;
  attempt: number;
  valid: boolean;
  validity: PlanningTrialValidity;
  runId: string | null;
  tracePath: string | null;
  metrics: PlanningTrialMetrics | null;
};

export type PlanningArmAverages = {
  modelCalls: number | null;
  toolCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number | null;
  plannerModelCalls: number | null;
  plannerToolCalls: number | null;
  workerModelCalls: number | null;
  workerToolCalls: number | null;
  verificationRepairAttempts: number | null;
  reviewRepairAttempts: number | null;
};

export type PlanningArmReport = {
  id: PlanningArmId;
  label: string;
  planningEnabled: boolean;
  attemptedTrials: number;
  validTrials: number;
  expectedMet: number;
  firstVerificationPass: number;
  trials: PlanningTrialRecord[];
  contaminated: PlanningTrialRecord[];
  averages: PlanningArmAverages;
};

export type PlanningQualityComparison =
  | "variant_worse"
  | "variant_better"
  | "equal"
  | "noisy";

export type PlanningEfficiencyComparison =
  | "variant_better"
  | "variant_worse"
  | "equal"
  | "noisy";

export type PlanningConclusion = "reject" | "candidate" | "inconclusive";

export type PlanningDecision = {
  quality: PlanningQualityComparison;
  efficiency: PlanningEfficiencyComparison;
  conclusion: PlanningConclusion;
  defaultUnchanged: true;
  notes: string[];
};

export type PlanningExperimentResult = {
  experimentId: string;
  generatedAt: string;
  taskId: typeof PLANNING_TASK_ID;
  contextMode: typeof PLANNING_CONTEXT_MODE;
  conversationStateMode: typeof PLANNING_CONVERSATION_STATE_MODE;
  hypothesis: string;
  decisionRule: string;
  baseline: PlanningArmReport;
  variant: PlanningArmReport;
  decision: PlanningDecision;
  report: string;
};

export type PlanningProbeAttempt = {
  fixtureApplied: boolean;
  result: HarnessRunResult | null;
  error: string | null;
};

export type PlanningExperimentDeps = {
  runTrial: (
    arm: PlanningArmId,
    runId: string,
  ) => Promise<PlanningProbeAttempt>;
  scoreExpected: (result: HarnessRunResult) => boolean;
};

const HYPOTHESIS =
  "An explicit read-only Planner that emits a structured advisory Plan can improve Worker reliability or end-to-end efficiency on a multi-layer feature without becoming authority, without changing Reviewer independence, and without becoming the default architecture.";

export function isExpectedP01Outcome(result: HarnessRunResult): boolean {
  return (
    result.workflowStatus === "success" &&
    result.specDecision?.status === "executable" &&
    result.implementationStarted === true &&
    result.finalVerificationPassed === true
  );
}

export function assessPlanningTrialValidity(options: {
  fixtureApplied: boolean;
  error: string | null;
  result: HarnessRunResult | null;
}): PlanningTrialValidity {
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

export async function runPlanningExperiment(
  deps: PlanningExperimentDeps,
): Promise<PlanningExperimentResult> {
  const generatedAt = new Date().toISOString();
  const baseline = await collectArm(deps, "baseline");
  const variant = await collectArm(deps, "variant");
  const result: PlanningExperimentResult = {
    experimentId: PLANNING_EXPERIMENT_ID,
    generatedAt,
    taskId: PLANNING_TASK_ID,
    contextMode: PLANNING_CONTEXT_MODE,
    conversationStateMode: PLANNING_CONVERSATION_STATE_MODE,
    hypothesis: HYPOTHESIS,
    decisionRule: PREDEFINED_DECISION_RULE,
    baseline,
    variant,
    decision: evaluatePlanningDecision(baseline, variant),
    report: "",
  };
  result.report = formatPlanningReport(result);
  return result;
}

export function writePlanningExperimentArtifact(
  result: PlanningExperimentResult,
): { jsonPath: string; reportPath: string; lessonDir: string } {
  const stamp = result.generatedAt.replace(/[:.]/g, "-");
  const evalsDir = path.join(REPO_ROOT, "evals");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/12-planner-worker-reviewer/traces",
  );
  fs.mkdirSync(evalsDir, { recursive: true });
  fs.mkdirSync(lessonDir, { recursive: true });

  const jsonName = `planning-m12-${stamp}.json`;
  const reportName = `planning-m12-${stamp}.txt`;
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

export function evaluatePlanningDecision(
  baseline: PlanningArmReport,
  variant: PlanningArmReport,
): PlanningDecision {
  const notes: string[] = [];
  if (baseline.validTrials < PLANNING_TRIALS_PER_ARM) {
    notes.push(
      `baseline valid trials ${baseline.validTrials}/${PLANNING_TRIALS_PER_ARM}`,
    );
  }
  if (variant.validTrials < PLANNING_TRIALS_PER_ARM) {
    notes.push(
      `variant valid trials ${variant.validTrials}/${PLANNING_TRIALS_PER_ARM}`,
    );
  }

  const quality = compareQuality(baseline, variant, notes);
  const efficiency = compareEfficiency(baseline, variant, notes);
  const conclusion = conclusionFromRule(quality, efficiency);
  notes.push("Planner is not made the default by this experiment code.");

  return {
    quality,
    efficiency,
    conclusion,
    defaultUnchanged: true,
    notes,
  };
}

export function formatPlanningReport(result: PlanningExperimentResult): string {
  return [
    `=== Planner / Worker Experiment (${result.experimentId}) ===`,
    "",
    `task: ${result.taskId}`,
    `context_mode: ${result.contextMode}`,
    `conversation_state_mode: ${result.conversationStateMode}`,
    `hypothesis: ${result.hypothesis}`,
    "",
    result.decisionRule,
    "",
    formatArm(result.baseline),
    "",
    formatArm(result.variant),
    "",
    "Decision",
    `quality: ${result.decision.quality}`,
    `end_to_end_efficiency: ${result.decision.efficiency}`,
    `conclusion: ${result.decision.conclusion}`,
    `default_unchanged: yes`,
    `candidate_to_adopt: ${result.decision.conclusion === "candidate" ? "yes" : "no"}`,
    ...(result.decision.notes.length
      ? result.decision.notes.map((note) => `note: ${note}`)
      : []),
  ].join("\n");
}

async function collectArm(
  deps: PlanningExperimentDeps,
  arm: PlanningArmId,
): Promise<PlanningArmReport> {
  const trials: PlanningTrialRecord[] = [];
  const contaminated: PlanningTrialRecord[] = [];
  let attempt = 0;
  const maxAttempts = PLANNING_TRIALS_PER_ARM * 2;
  while (trials.length < PLANNING_TRIALS_PER_ARM && attempt < maxAttempts) {
    attempt += 1;
    const runId = `P01-plan-${arm}-${attempt}-${timestamp()}`;
    console.log(`\n=== Planning ${arm} trial ${attempt} (${runId}) ===`);
    const probe = await deps.runTrial(arm, runId);
    const validity = assessPlanningTrialValidity(probe);
    const record: PlanningTrialRecord = {
      arm,
      attempt,
      valid: validity.valid,
      validity,
      runId: probe.result ? runIdFromTrace(probe.result.tracePath) : null,
      tracePath: probe.result?.tracePath ?? null,
      metrics: probe.result
        ? trialMetrics(probe.result, arm, deps.scoreExpected(probe.result))
        : null,
    };
    if (validity.valid && record.metrics) {
      trials.push(record);
      console.log(
        `planning_trial: expected=${record.metrics.expectedOutcomeMet ? "yes" : "no"} planner=${record.metrics.plannerModelCalls}/${record.metrics.plannerToolCalls} workflow_calls=${record.metrics.modelCalls}`,
      );
    } else {
      contaminated.push(record);
      console.log(
        `planning_trial_contaminated: ${validity.reason}${validity.detail ? ` ${validity.detail}` : ""}`,
      );
    }
  }

  return {
    id: arm,
    label:
      arm === "baseline"
        ? "BASELINE — Spec → Worker (implicit planning)"
        : "VARIANT — Spec → read-only Planner → Worker",
    planningEnabled: arm === "variant",
    attemptedTrials: attempt,
    validTrials: trials.length,
    expectedMet: trials.filter((item) => item.metrics?.expectedOutcomeMet)
      .length,
    firstVerificationPass: trials.filter(
      (item) => item.metrics?.firstVerification === "PASS",
    ).length,
    trials,
    contaminated,
    averages: averageMetrics(trials),
  };
}

function trialMetrics(
  result: HarnessRunResult,
  arm: PlanningArmId,
  expected: boolean,
): PlanningTrialMetrics {
  const usage = result.contextMetrics.tokenUsage;
  const plan: Plan | null = result.plan;
  const deviation = plan
    ? planDeviation(plan, result.changedFiles)
    : {
        plannedLikelyFiles: [] as string[],
        actualChangedFiles: result.changedFiles,
        extraChangedFiles: result.changedFiles,
        unusedLikelyFiles: [] as string[],
      };

  return {
    expectedOutcomeMet: expected,
    workflowStatus: result.workflowStatus,
    finalVerification: result.implementationStarted
      ? result.finalVerificationPassed
        ? "PASS"
        : "FAIL"
      : "skipped",
    firstVerification:
      result.verifications[0] === undefined
        ? "missing"
        : result.verifications[0].passed
          ? "PASS"
          : "FAIL",
    verificationRepairAttempts: result.repairAttempts,
    reviewRepairAttempts: result.reviewRepairAttempts,
    acceptedBlockingFindings: result.acceptedBlockingFindings.length,
    changedFiles: [...result.changedFiles],
    modelCalls: result.modelCalls,
    toolCalls: result.toolCalls,
    inputTokens: usage?.totalInputTokens ?? null,
    outputTokens: usage?.totalOutputTokens ?? null,
    wallTimeMs: result.durationMs,
    plannerModelCalls: result.plannerModelCalls,
    plannerToolCalls: result.plannerToolCalls,
    plannerInputTokens: usage?.plannerInputTokens ?? null,
    plannerOutputTokens: usage?.plannerOutputTokens ?? null,
    plannerWallTimeMs: result.plannerDurationMs,
    workerModelCalls: result.implementation?.modelCalls ?? 0,
    workerToolCalls: result.implementation?.toolCalls ?? 0,
    plannedLikelyFiles: plan ? plannedLikelyFiles(plan) : [],
    actualChangedFiles: deviation.actualChangedFiles,
    extraChangedFiles: deviation.extraChangedFiles,
    unusedLikelyFiles: deviation.unusedLikelyFiles,
    planningEnabled: result.planningEnabled,
    planAccepted: Boolean(plan) && arm === "variant",
  };
}

function compareQuality(
  baseline: PlanningArmReport,
  variant: PlanningArmReport,
  notes: string[],
): PlanningQualityComparison {
  if (
    baseline.validTrials !== PLANNING_TRIALS_PER_ARM ||
    variant.validTrials !== PLANNING_TRIALS_PER_ARM
  ) {
    notes.push("quality comparison limited by missing valid trials");
    return "noisy";
  }

  const baselineExpected = baseline.expectedMet;
  const variantExpected = variant.expectedMet;
  const baselineFirst = baseline.firstVerificationPass;
  const variantFirst = variant.firstVerificationPass;
  const baselineRepairs = baseline.averages.verificationRepairAttempts ?? 0;
  const variantRepairs = variant.averages.verificationRepairAttempts ?? 0;
  const baselineReviewRepairs = baseline.averages.reviewRepairAttempts ?? 0;
  const variantReviewRepairs = variant.averages.reviewRepairAttempts ?? 0;

  if (variantExpected < baselineExpected) {
    notes.push(
      `variant expected ${variantExpected}/${PLANNING_TRIALS_PER_ARM} vs baseline ${baselineExpected}/${PLANNING_TRIALS_PER_ARM}`,
    );
    return "variant_worse";
  }
  if (variantExpected > baselineExpected) {
    notes.push(
      `variant expected ${variantExpected}/${PLANNING_TRIALS_PER_ARM} vs baseline ${baselineExpected}/${PLANNING_TRIALS_PER_ARM}`,
    );
    return "variant_better";
  }

  const firstPassBetter =
    variantFirst > baselineFirst ||
    variantRepairs < baselineRepairs ||
    variantReviewRepairs < baselineReviewRepairs;
  const firstPassWorse =
    variantFirst < baselineFirst ||
    variantRepairs > baselineRepairs ||
    variantReviewRepairs > baselineReviewRepairs;

  if (firstPassBetter && !firstPassWorse) {
    notes.push(
      `first-pass/repair quality improved: first_verify ${baselineFirst}→${variantFirst}, verify_repairs ${fmtNum(baseline.averages.verificationRepairAttempts)}→${fmtNum(variant.averages.verificationRepairAttempts)}, review_repairs ${fmtNum(baseline.averages.reviewRepairAttempts)}→${fmtNum(variant.averages.reviewRepairAttempts)}`,
    );
    return "variant_better";
  }
  if (firstPassWorse && !firstPassBetter) {
    notes.push("first-pass/repair quality worsened on variant");
    return "variant_worse";
  }
  if (firstPassBetter && firstPassWorse) {
    notes.push("first-pass/repair signals conflict");
    return "noisy";
  }
  return "equal";
}

function compareEfficiency(
  baseline: PlanningArmReport,
  variant: PlanningArmReport,
  notes: string[],
): PlanningEfficiencyComparison {
  const keys: Array<keyof PlanningArmAverages> = [
    "modelCalls",
    "toolCalls",
    "inputTokens",
    "outputTokens",
    "wallTimeMs",
  ];
  const better: string[] = [];
  const worse: string[] = [];
  const missing: string[] = [];

  for (const key of keys) {
    const left = baseline.averages[key];
    const right = variant.averages[key];
    if (left === null || right === null) {
      missing.push(key);
      continue;
    }
    if (right < left) {
      better.push(`${key} ${fmtNum(left)}→${fmtNum(right)}`);
    } else if (right > left) {
      worse.push(`${key} ${fmtNum(left)}→${fmtNum(right)}`);
    }
  }

  if (missing.length) {
    notes.push(`efficiency fields missing: ${missing.join(", ")}`);
  }
  if (better.length) {
    notes.push(`e2e lower on variant: ${better.join("; ")}`);
  }
  if (worse.length) {
    notes.push(`e2e higher on variant: ${worse.join("; ")}`);
  }

  const workerOnly =
    (variant.averages.workerModelCalls ?? 0) <
      (baseline.averages.workerModelCalls ?? 0) ||
    (variant.averages.workerToolCalls ?? 0) <
      (baseline.averages.workerToolCalls ?? 0);
  if (workerOnly) {
    notes.push(
      "Worker-only discovery/call reduction is not sufficient for adoption",
    );
  }

  if (better.length && !worse.length) {
    return "variant_better";
  }
  if (worse.length && !better.length) {
    return "variant_worse";
  }
  if (better.length && worse.length) {
    return "noisy";
  }
  if (missing.length) {
    return "noisy";
  }
  return "equal";
}

function conclusionFromRule(
  quality: PlanningQualityComparison,
  efficiency: PlanningEfficiencyComparison,
): PlanningConclusion {
  if (quality === "noisy") {
    return "inconclusive";
  }
  if (quality === "variant_worse") {
    return "reject";
  }
  if (quality === "variant_better") {
    return "candidate";
  }
  if (efficiency === "variant_worse") {
    return "reject";
  }
  return "inconclusive";
}

function averageMetrics(trials: PlanningTrialRecord[]): PlanningArmAverages {
  const metrics = trials
    .map((trial) => trial.metrics)
    .filter((item): item is PlanningTrialMetrics => item !== null);
  return {
    modelCalls: mean(metrics.map((item) => item.modelCalls)),
    toolCalls: mean(metrics.map((item) => item.toolCalls)),
    inputTokens: mean(metrics.map((item) => item.inputTokens)),
    outputTokens: mean(metrics.map((item) => item.outputTokens)),
    wallTimeMs: mean(metrics.map((item) => item.wallTimeMs)),
    plannerModelCalls: mean(metrics.map((item) => item.plannerModelCalls)),
    plannerToolCalls: mean(metrics.map((item) => item.plannerToolCalls)),
    workerModelCalls: mean(metrics.map((item) => item.workerModelCalls)),
    workerToolCalls: mean(metrics.map((item) => item.workerToolCalls)),
    verificationRepairAttempts: mean(
      metrics.map((item) => item.verificationRepairAttempts),
    ),
    reviewRepairAttempts: mean(
      metrics.map((item) => item.reviewRepairAttempts),
    ),
  };
}

function formatArm(arm: PlanningArmReport): string {
  const lines = [
    arm.label,
    `planning_enabled: ${arm.planningEnabled ? "yes" : "no"}`,
    `valid_trials: ${arm.validTrials} / attempted ${arm.attemptedTrials}`,
    `contaminated: ${arm.contaminated.length}`,
    `expected: ${arm.expectedMet}/${arm.validTrials || PLANNING_TRIALS_PER_ARM}`,
    `first_verify_pass: ${arm.firstVerificationPass}/${arm.validTrials || PLANNING_TRIALS_PER_ARM}`,
  ];
  for (const trial of arm.trials) {
    const m = trial.metrics!;
    lines.push(
      `  valid#${trial.attempt} expected=${m.expectedOutcomeMet ? "yes" : "no"} workflow=${m.workflowStatus} verify=${m.firstVerification}→${m.finalVerification} repairs=${m.verificationRepairAttempts} review_repairs=${m.reviewRepairAttempts} blocking=${m.acceptedBlockingFindings} calls=${m.modelCalls}/${m.toolCalls} tokens=${fmtNum(m.inputTokens)}/${fmtNum(m.outputTokens)} wall_ms=${m.wallTimeMs} planner=${m.plannerModelCalls}/${m.plannerToolCalls} worker=${m.workerModelCalls}/${m.workerToolCalls} files=${m.changedFiles.join(",") || "(none)"} planned=${m.plannedLikelyFiles.join(",") || "(none)"} extra=${m.extraChangedFiles.join(",") || "(none)"} unused=${m.unusedLikelyFiles.join(",") || "(none)"}`,
    );
  }
  for (const trial of arm.contaminated) {
    lines.push(
      `  contaminated#${trial.attempt} ${trial.validity.reason}${trial.validity.detail ? ` ${trial.validity.detail}` : ""}`,
    );
  }
  const avg = arm.averages;
  lines.push(
    `  averages: calls=${fmtNum(avg.modelCalls)}/${fmtNum(avg.toolCalls)} tokens=${fmtNum(avg.inputTokens)}/${fmtNum(avg.outputTokens)} wall_ms=${fmtNum(avg.wallTimeMs)} planner=${fmtNum(avg.plannerModelCalls)}/${fmtNum(avg.plannerToolCalls)} worker=${fmtNum(avg.workerModelCalls)}/${fmtNum(avg.workerToolCalls)} repairs=${fmtNum(avg.verificationRepairAttempts)} review_repairs=${fmtNum(avg.reviewRepairAttempts)}`,
  );
  return lines.join("\n");
}

function copyTrialTraces(
  result: PlanningExperimentResult,
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
  }
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

function runIdFromTrace(tracePath: string): string {
  return path.basename(tracePath, ".jsonl");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
