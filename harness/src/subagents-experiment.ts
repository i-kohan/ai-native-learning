import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.ts";
import {
  duplicatedReadPaths,
  type EvidenceReport,
} from "./evidence.ts";
import type { HarnessRunResult } from "./run.ts";

export const SUBAGENTS_EXPERIMENT_ID = "m13-p01-subagents";
export const SUBAGENTS_TASK_ID = "P01";
export const SUBAGENTS_CONTEXT_MODE = "variant" as const;
export const SUBAGENTS_CONVERSATION_STATE_MODE = "manual" as const;
export const SUBAGENTS_TRIALS_PER_ARM = 3;

export type SubagentsArmId = "baseline" | "variant";

export const PREDEFINED_DECISION_RULE = [
  "Predefined decision rule (encoded before the experiment):",
  "1. If Variant has worse correctness/reliability than Baseline: reject Subagents.",
  "2. If Variant shows a clear reliability / first-pass-quality improvement: Subagents becomes an inspection candidate even with modest extra overhead. Do not auto-adopt.",
  "3. If quality is equal and Variant is clearly more expensive end-to-end: reject for current workload.",
  "4. If quality is equal and the mechanism works but the workload is too small to show a benefit: mechanism understood / ROI inconclusive. Do not invent a post-hoc numeric threshold.",
  "5. A correct EvidenceReport proves only mechanism correctness, not adoption.",
  "6. Unused optional delegation is evidence, not a reason to force the prompt.",
  "Equal-quality operationalization: no numeric meaningful-efficiency threshold was predefined. Clear e2e regression → reject. Conflicting or directionally better e2e without a predefined meaningful threshold → inconclusive, not candidate. Compare model calls, tool calls, input tokens, output tokens, and wall time. Child cost is included in end-to-end totals.",
].join("\n");

export type SubagentsTrialValidityReason =
  | "valid"
  | "run_error"
  | "fixture_not_applied";

export type SubagentsTrialValidity = {
  valid: boolean;
  reason: SubagentsTrialValidityReason;
  detail?: string;
};

export type SubagentsTrialMetrics = {
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
  workerModelCalls: number;
  workerToolCalls: number;
  workerReadPaths: string[];
  childModelCalls: number;
  childToolCalls: number;
  childInputTokens: number | null;
  childOutputTokens: number | null;
  childDurationMs: number;
  childInspectedPaths: string[];
  duplicatedReadPaths: string[];
  delegationInvoked: boolean;
  delegationCount: number;
  evidenceReport: EvidenceReport | null;
  subagentsEnabled: boolean;
};

export type SubagentsTrialRecord = {
  arm: SubagentsArmId;
  attempt: number;
  valid: boolean;
  validity: SubagentsTrialValidity;
  runId: string | null;
  tracePath: string | null;
  metrics: SubagentsTrialMetrics | null;
};

export type SubagentsArmAverages = {
  modelCalls: number | null;
  toolCalls: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number | null;
  workerModelCalls: number | null;
  workerToolCalls: number | null;
  childModelCalls: number | null;
  childToolCalls: number | null;
  verificationRepairAttempts: number | null;
  reviewRepairAttempts: number | null;
};

export type SubagentsArmReport = {
  id: SubagentsArmId;
  label: string;
  subagentsEnabled: boolean;
  attemptedTrials: number;
  validTrials: number;
  expectedMet: number;
  firstVerificationPass: number;
  delegationInvoked: number;
  trials: SubagentsTrialRecord[];
  contaminated: SubagentsTrialRecord[];
  averages: SubagentsArmAverages;
};

export type SubagentsQualityComparison =
  | "variant_worse"
  | "variant_better"
  | "equal"
  | "noisy";

export type SubagentsEfficiencyComparison =
  | "variant_better"
  | "variant_worse"
  | "equal"
  | "noisy";

export type SubagentsConclusion = "reject" | "candidate" | "inconclusive";

export type SubagentsDecision = {
  quality: SubagentsQualityComparison;
  efficiency: SubagentsEfficiencyComparison;
  conclusion: SubagentsConclusion;
  defaultUnchanged: true;
  adoptionStatus: string;
  notes: string[];
};

export type SubagentsExperimentResult = {
  experimentId: string;
  generatedAt: string;
  taskId: typeof SUBAGENTS_TASK_ID;
  contextMode: typeof SUBAGENTS_CONTEXT_MODE;
  conversationStateMode: typeof SUBAGENTS_CONVERSATION_STATE_MODE;
  hypothesis: string;
  decisionRule: string;
  baseline: SubagentsArmReport;
  variant: SubagentsArmReport;
  decision: SubagentsDecision;
  report: string;
};

export type SubagentsProbeAttempt = {
  fixtureApplied: boolean;
  result: HarnessRunResult | null;
  error: string | null;
};

export type SubagentsExperimentDeps = {
  runTrial: (
    arm: SubagentsArmId,
    runId: string,
  ) => Promise<SubagentsProbeAttempt>;
  scoreExpected: (result: HarnessRunResult) => boolean;
};

const HYPOTHESIS =
  "An optional bounded research child invoked as a Worker tool can return validated EvidenceReport advice without becoming authority, and may or may not repay coordination cost on a small feature-sized task.";

export function assessSubagentsTrialValidity(options: {
  fixtureApplied: boolean;
  error: string | null;
  result: HarnessRunResult | null;
}): SubagentsTrialValidity {
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

export async function runSubagentsExperiment(
  deps: SubagentsExperimentDeps,
): Promise<SubagentsExperimentResult> {
  const generatedAt = new Date().toISOString();
  const baseline = await collectArm(deps, "baseline");
  const variant = await collectArm(deps, "variant");
  const result: SubagentsExperimentResult = {
    experimentId: SUBAGENTS_EXPERIMENT_ID,
    generatedAt,
    taskId: SUBAGENTS_TASK_ID,
    contextMode: SUBAGENTS_CONTEXT_MODE,
    conversationStateMode: SUBAGENTS_CONVERSATION_STATE_MODE,
    hypothesis: HYPOTHESIS,
    decisionRule: PREDEFINED_DECISION_RULE,
    baseline,
    variant,
    decision: evaluateSubagentsDecision(baseline, variant),
    report: "",
  };
  result.report = formatSubagentsReport(result);
  return result;
}

export function writeSubagentsExperimentArtifact(
  result: SubagentsExperimentResult,
): { jsonPath: string; reportPath: string; lessonDir: string } {
  const stamp = result.generatedAt.replace(/[:.]/g, "-");
  const evalsDir = path.join(REPO_ROOT, "evals");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/13-subagents/traces",
  );
  fs.mkdirSync(evalsDir, { recursive: true });
  fs.mkdirSync(lessonDir, { recursive: true });

  const jsonName = `subagents-m13-${stamp}.json`;
  const reportName = `subagents-m13-${stamp}.txt`;
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

export function evaluateSubagentsDecision(
  baseline: SubagentsArmReport,
  variant: SubagentsArmReport,
): SubagentsDecision {
  const notes: string[] = [];
  if (baseline.validTrials < SUBAGENTS_TRIALS_PER_ARM) {
    notes.push(
      `baseline valid trials ${baseline.validTrials}/${SUBAGENTS_TRIALS_PER_ARM}`,
    );
  }
  if (variant.validTrials < SUBAGENTS_TRIALS_PER_ARM) {
    notes.push(
      `variant valid trials ${variant.validTrials}/${SUBAGENTS_TRIALS_PER_ARM}`,
    );
  }
  if (variant.delegationInvoked === 0) {
    notes.push(
      "variant never invoked delegate_research; unused optional capability is evidence, not a quality win",
    );
  }

  const quality = compareQuality(baseline, variant, notes);
  const efficiency = compareEfficiency(baseline, variant, notes);
  const conclusion = conclusionFromRule(quality, efficiency);
  notes.push("Subagents are not made the default by this experiment code.");

  return {
    quality,
    efficiency,
    conclusion,
    defaultUnchanged: true,
    adoptionStatus: adoptionStatus(quality, efficiency, conclusion),
    notes,
  };
}

export function formatSubagentsReport(
  result: SubagentsExperimentResult,
): string {
  return [
    `=== Subagents Research Child Experiment (${result.experimentId}) ===`,
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
    `adoption_status: ${result.decision.adoptionStatus}`,
    `default_unchanged: yes`,
    `candidate_to_adopt: ${result.decision.conclusion === "candidate" ? "inspect" : "no"}`,
    ...(result.decision.notes.length
      ? result.decision.notes.map((note) => `note: ${note}`)
      : []),
  ].join("\n");
}

async function collectArm(
  deps: SubagentsExperimentDeps,
  arm: SubagentsArmId,
): Promise<SubagentsArmReport> {
  const trials: SubagentsTrialRecord[] = [];
  const contaminated: SubagentsTrialRecord[] = [];
  let attempt = 0;
  const maxAttempts = SUBAGENTS_TRIALS_PER_ARM * 2;
  while (trials.length < SUBAGENTS_TRIALS_PER_ARM && attempt < maxAttempts) {
    attempt += 1;
    const runId = `P01-subagents-${arm}-${attempt}-${timestamp()}`;
    console.log(`\n=== Subagents ${arm} trial ${attempt} (${runId}) ===`);
    const probe = await deps.runTrial(arm, runId);
    const validity = assessSubagentsTrialValidity(probe);
    const record: SubagentsTrialRecord = {
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
        `subagents_trial: expected=${record.metrics.expectedOutcomeMet ? "yes" : "no"} delegated=${record.metrics.delegationInvoked ? "yes" : "no"} child=${record.metrics.childModelCalls}/${record.metrics.childToolCalls} workflow_calls=${record.metrics.modelCalls}`,
      );
    } else {
      contaminated.push(record);
      console.log(
        `subagents_trial_contaminated: ${validity.reason}${validity.detail ? ` ${validity.detail}` : ""}`,
      );
    }
  }

  return {
    id: arm,
    label:
      arm === "baseline"
        ? "BASELINE — Spec → Worker (no research child)"
        : "VARIANT — Spec → Worker with optional delegate_research",
    subagentsEnabled: arm === "variant",
    attemptedTrials: attempt,
    validTrials: trials.length,
    expectedMet: trials.filter((item) => item.metrics?.expectedOutcomeMet)
      .length,
    firstVerificationPass: trials.filter(
      (item) => item.metrics?.firstVerification === "PASS",
    ).length,
    delegationInvoked: trials.filter((item) => item.metrics?.delegationInvoked)
      .length,
    trials,
    contaminated,
    averages: averageMetrics(trials),
  };
}

function trialMetrics(
  result: HarnessRunResult,
  arm: SubagentsArmId,
  expected: boolean,
): SubagentsTrialMetrics {
  const usage = result.contextMetrics.tokenUsage;
  const delegations = result.implementation?.researchDelegations ?? [];
  const accepted = delegations.filter((item) => item.outcome === "accepted");
  const report = accepted[0]?.report ?? null;
  const workerReadPaths = result.implementation?.discovery.readFilePaths ?? [];
  const childInspectedPaths = unique(
    delegations.flatMap((item) => item.inspectedPaths.readFiles),
  );

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
    workerModelCalls: result.implementation?.modelCalls ?? 0,
    workerToolCalls: result.implementation?.toolCalls ?? 0,
    workerReadPaths,
    childModelCalls: delegations.reduce(
      (sum, item) => sum + item.childModelCalls,
      0,
    ),
    childToolCalls: delegations.reduce(
      (sum, item) => sum + item.childToolCalls,
      0,
    ),
    childInputTokens: usage?.researchInputTokens ?? null,
    childOutputTokens: usage?.researchOutputTokens ?? null,
    childDurationMs: delegations.reduce(
      (sum, item) => sum + item.childDurationMs,
      0,
    ),
    childInspectedPaths,
    duplicatedReadPaths: duplicatedReadPaths(workerReadPaths, childInspectedPaths),
    delegationInvoked: delegations.length > 0,
    delegationCount: delegations.length,
    evidenceReport: report,
    subagentsEnabled: result.subagentsEnabled && arm === "variant",
  };
}

function compareQuality(
  baseline: SubagentsArmReport,
  variant: SubagentsArmReport,
  notes: string[],
): SubagentsQualityComparison {
  if (
    baseline.validTrials !== SUBAGENTS_TRIALS_PER_ARM ||
    variant.validTrials !== SUBAGENTS_TRIALS_PER_ARM
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
      `variant expected ${variantExpected}/${SUBAGENTS_TRIALS_PER_ARM} vs baseline ${baselineExpected}/${SUBAGENTS_TRIALS_PER_ARM}`,
    );
    return "variant_worse";
  }
  if (variantExpected > baselineExpected) {
    notes.push(
      `variant expected ${variantExpected}/${SUBAGENTS_TRIALS_PER_ARM} vs baseline ${baselineExpected}/${SUBAGENTS_TRIALS_PER_ARM}`,
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
    notes.push("first-pass/repair quality improved on variant");
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
  baseline: SubagentsArmReport,
  variant: SubagentsArmReport,
  notes: string[],
): SubagentsEfficiencyComparison {
  const keys: Array<keyof SubagentsArmAverages> = [
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
  quality: SubagentsQualityComparison,
  efficiency: SubagentsEfficiencyComparison,
): SubagentsConclusion {
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

function adoptionStatus(
  quality: SubagentsQualityComparison,
  efficiency: SubagentsEfficiencyComparison,
  conclusion: SubagentsConclusion,
): string {
  if (conclusion === "candidate") {
    return "inspect for possible adopt";
  }
  if (quality === "equal" && efficiency === "variant_worse") {
    return "reject for current workload";
  }
  if (quality === "variant_worse") {
    return "reject";
  }
  return "mechanism understood / ROI inconclusive";
}

function averageMetrics(
  trials: SubagentsTrialRecord[],
): SubagentsArmAverages {
  const metrics = trials
    .map((trial) => trial.metrics)
    .filter((item): item is SubagentsTrialMetrics => item !== null);
  return {
    modelCalls: mean(metrics.map((item) => item.modelCalls)),
    toolCalls: mean(metrics.map((item) => item.toolCalls)),
    inputTokens: mean(metrics.map((item) => item.inputTokens)),
    outputTokens: mean(metrics.map((item) => item.outputTokens)),
    wallTimeMs: mean(metrics.map((item) => item.wallTimeMs)),
    workerModelCalls: mean(metrics.map((item) => item.workerModelCalls)),
    workerToolCalls: mean(metrics.map((item) => item.workerToolCalls)),
    childModelCalls: mean(metrics.map((item) => item.childModelCalls)),
    childToolCalls: mean(metrics.map((item) => item.childToolCalls)),
    verificationRepairAttempts: mean(
      metrics.map((item) => item.verificationRepairAttempts),
    ),
    reviewRepairAttempts: mean(
      metrics.map((item) => item.reviewRepairAttempts),
    ),
  };
}

function formatArm(arm: SubagentsArmReport): string {
  const lines = [
    arm.label,
    `subagents_enabled: ${arm.subagentsEnabled ? "yes" : "no"}`,
    `valid_trials: ${arm.validTrials} / attempted ${arm.attemptedTrials}`,
    `contaminated: ${arm.contaminated.length}`,
    `expected: ${arm.expectedMet}/${arm.validTrials || SUBAGENTS_TRIALS_PER_ARM}`,
    `first_verify_pass: ${arm.firstVerificationPass}/${arm.validTrials || SUBAGENTS_TRIALS_PER_ARM}`,
    `delegation_invoked: ${arm.delegationInvoked}/${arm.validTrials || SUBAGENTS_TRIALS_PER_ARM}`,
  ];
  for (const trial of arm.trials) {
    const m = trial.metrics!;
    lines.push(
      `  valid#${trial.attempt} expected=${m.expectedOutcomeMet ? "yes" : "no"} workflow=${m.workflowStatus} verify=${m.firstVerification}→${m.finalVerification} repairs=${m.verificationRepairAttempts} review_repairs=${m.reviewRepairAttempts} blocking=${m.acceptedBlockingFindings} calls=${m.modelCalls}/${m.toolCalls} tokens=${fmtNum(m.inputTokens)}/${fmtNum(m.outputTokens)} wall_ms=${m.wallTimeMs} worker=${m.workerModelCalls}/${m.workerToolCalls} child=${m.childModelCalls}/${m.childToolCalls} delegated=${m.delegationInvoked ? "yes" : "no"} duplicate_reads=${m.duplicatedReadPaths.join(",") || "(none)"} files=${m.changedFiles.join(",") || "(none)"}`,
    );
  }
  for (const trial of arm.contaminated) {
    lines.push(
      `  contaminated#${trial.attempt} ${trial.validity.reason}${trial.validity.detail ? ` ${trial.validity.detail}` : ""}`,
    );
  }
  const avg = arm.averages;
  lines.push(
    `  averages: calls=${fmtNum(avg.modelCalls)}/${fmtNum(avg.toolCalls)} tokens=${fmtNum(avg.inputTokens)}/${fmtNum(avg.outputTokens)} wall_ms=${fmtNum(avg.wallTimeMs)} worker=${fmtNum(avg.workerModelCalls)}/${fmtNum(avg.workerToolCalls)} child=${fmtNum(avg.childModelCalls)}/${fmtNum(avg.childToolCalls)} repairs=${fmtNum(avg.verificationRepairAttempts)} review_repairs=${fmtNum(avg.reviewRepairAttempts)}`,
  );
  return lines.join("\n");
}

function copyTrialTraces(
  result: SubagentsExperimentResult,
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

function unique(items: string[]): string[] {
  return [...new Set(items)];
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
