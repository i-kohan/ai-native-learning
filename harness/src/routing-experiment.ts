import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.ts";
import type { TokenUsageSummary } from "./context.ts";
import { isIntendedR01ControlledFailure } from "./r01-fault.ts";
import type { RoutingReason } from "./model-routing.ts";
import type { HarnessRunResult } from "./run.ts";

export const ROUTING_EXPERIMENT_ID = "m10-repair-routing";
export const ROUTING_DEFAULT_MODEL = "gpt-5.6-luna";
export const ROUTING_REPAIR_CANDIDATE = "gpt-5.6-terra";
export const ROUTING_VALID_TRIALS_PER_ARM = 3;
export const ROUTING_MAX_ATTEMPTS_PER_ARM = 6;

export type RoutingArmId = "baseline" | "variant";

export type RoutingTrialValidityReason =
  | "valid"
  | "run_error"
  | "fault_not_injected"
  | "first_verify_not_fail"
  | "normalized_failure_missing"
  | "failure_not_intended_r01"
  | "repair_did_not_start";

export type RoutingTrialEvidence = {
  injected: boolean;
  error: string | null;
  firstVerificationPassed: boolean | null;
  normalizedFailure: HarnessRunResult["verifications"][number]["normalizedFailure"];
  repairStarted: boolean;
};

export type RoutingTrialValidity = {
  valid: boolean;
  reason: RoutingTrialValidityReason;
  detail?: string;
};

export type RoutingTrialMetrics = {
  repairModel: string;
  routingReason: RoutingReason;
  phase: "repair";
  expectedOutcomeMet: boolean;
  firstVerify: "PASS" | "FAIL" | "missing";
  secondVerify: "PASS" | "FAIL" | "missing";
  repairSuccess: boolean;
  eventualWorkflowSuccess: boolean;
  repeatedFailure: boolean;
  repairAttempts: number;
  verificationAttempts: number;
  repairModelCalls: number;
  repairToolCalls: number;
  repairInputTokens: number | null;
  repairOutputTokens: number | null;
  repairWallTimeMs: number | null;
  workflowModelCalls: number;
  workflowInputTokens: number | null;
  workflowOutputTokens: number | null;
  workflowWallTimeMs: number;
};

export type RoutingTrialRecord = {
  arm: RoutingArmId;
  attempt: number;
  valid: boolean;
  validity: RoutingTrialValidity;
  runId: string | null;
  tracePath: string | null;
  metrics: RoutingTrialMetrics | null;
};

export type RoutingArmAverages = {
  repairModelCalls: number | null;
  repairToolCalls: number | null;
  repairInputTokens: number | null;
  repairOutputTokens: number | null;
  repairWallTimeMs: number | null;
  workflowModelCalls: number | null;
  workflowInputTokens: number | null;
  workflowOutputTokens: number | null;
  workflowWallTimeMs: number | null;
};

export type RoutingArmReport = {
  id: RoutingArmId;
  label: string;
  repairModel: string;
  routingReason: RoutingReason;
  attemptedTrials: number;
  validTrials: number;
  sloMet: boolean | null;
  trials: RoutingTrialRecord[];
  contaminated: RoutingTrialRecord[];
  averages: RoutingArmAverages;
};

export type RoutingExperimentResult = {
  experimentId: string;
  generatedAt: string;
  defaultModel: string;
  qualitySlo: string;
  decisionRule: string;
  policyConclusion: "not_applied";
  baseline: RoutingArmReport;
  variant: RoutingArmReport;
  report: string;
};

export type RoutingProbeAttempt = {
  injected: boolean;
  result: HarnessRunResult | null;
  error: string | null;
};

export type RoutingExperimentDeps = {
  runTrial: (arm: RoutingArmId, runId: string) => Promise<RoutingProbeAttempt>;
  scoreExpected: (result: HarnessRunResult) => boolean;
};

const DECISION_RULE = [
  "Predefined decision rule (not applied by this report):",
  "1. Luna 3/3, Terra 3/3: compare efficiency. Stronger routing is justified only if Terra provides a meaningful reliability/latency/workflow benefit that offsets its substantially higher token price.",
  "2. Luna <3/3, Terra 3/3: repair → Terra becomes an evidence-supported routing candidate.",
  "3. both <3/3: do not conclude routing solves the problem.",
  "4. noisy / insufficient evidence: no permanent routing decision.",
].join("\n");

const QUALITY_SLO =
  "3/3 valid R01 trials satisfy the existing R01 repair contract (one verification-repair, FAIL then PASS, final PASS, no repeated failure, workflow success, source-only repair).";

export function assessRoutingTrialValidity(
  evidence: RoutingTrialEvidence,
): RoutingTrialValidity {
  if (evidence.error && evidence.firstVerificationPassed === null) {
    return {
      valid: false,
      reason: evidence.injected ? "run_error" : "fault_not_injected",
      detail: evidence.error,
    };
  }
  if (!evidence.injected) {
    return {
      valid: false,
      reason: "fault_not_injected",
      ...(evidence.error ? { detail: evidence.error } : {}),
    };
  }
  if (evidence.firstVerificationPassed !== false) {
    return { valid: false, reason: "first_verify_not_fail" };
  }
  if (!evidence.normalizedFailure) {
    return { valid: false, reason: "normalized_failure_missing" };
  }
  if (!isIntendedR01ControlledFailure(evidence.normalizedFailure)) {
    return {
      valid: false,
      reason: "failure_not_intended_r01",
      detail: evidence.normalizedFailure.signature,
    };
  }
  if (!evidence.repairStarted) {
    return { valid: false, reason: "repair_did_not_start" };
  }
  return { valid: true, reason: "valid" };
}

export function evidenceFromProbeAttempt(
  attempt: RoutingProbeAttempt,
): RoutingTrialEvidence {
  const first = attempt.result?.verifications[0];
  return {
    injected: attempt.injected,
    error: attempt.error,
    firstVerificationPassed: first ? first.passed : null,
    normalizedFailure: first?.normalizedFailure ?? null,
    repairStarted:
      (attempt.result?.repairAttempts ?? 0) > 0 ||
      (attempt.result?.repairs.length ?? 0) > 0,
  };
}

export async function runRoutingExperiment(
  deps: RoutingExperimentDeps,
): Promise<RoutingExperimentResult> {
  const generatedAt = new Date().toISOString();
  const baseline = await collectArm(deps, "baseline");
  const variant = await collectArm(deps, "variant");
  const result: RoutingExperimentResult = {
    experimentId: ROUTING_EXPERIMENT_ID,
    generatedAt,
    defaultModel: ROUTING_DEFAULT_MODEL,
    qualitySlo: QUALITY_SLO,
    decisionRule: DECISION_RULE,
    policyConclusion: "not_applied",
    baseline,
    variant,
    report: "",
  };
  result.report = formatRoutingReport(result);
  return result;
}

export function writeRoutingExperimentArtifact(
  result: RoutingExperimentResult,
): { jsonPath: string; reportPath: string; lessonDir: string } {
  const stamp = result.generatedAt.replace(/[:.]/g, "-");
  const evalsDir = path.join(REPO_ROOT, "evals");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/10-model-routing/traces",
  );
  fs.mkdirSync(evalsDir, { recursive: true });
  fs.mkdirSync(lessonDir, { recursive: true });

  const jsonName = `routing-m10-${stamp}.json`;
  const reportName = `routing-m10-${stamp}.txt`;
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

async function collectArm(
  deps: RoutingExperimentDeps,
  arm: RoutingArmId,
): Promise<RoutingArmReport> {
  const valid: RoutingTrialRecord[] = [];
  const contaminated: RoutingTrialRecord[] = [];
  let attempt = 0;

  while (
    valid.length < ROUTING_VALID_TRIALS_PER_ARM &&
    attempt < ROUTING_MAX_ATTEMPTS_PER_ARM
  ) {
    attempt += 1;
    const runId = `R01-routing-${arm}-${attempt}-${timestamp()}`;
    console.log(
      `\n=== Routing ${arm} attempt ${attempt} (${runId}) ===`,
    );
    const probe = await deps.runTrial(arm, runId);
    const record = toTrialRecord(deps, arm, attempt, probe);
    if (record.valid) {
      valid.push(record);
      console.log(
        `routing_trial: valid ${valid.length}/${ROUTING_VALID_TRIALS_PER_ARM} slo=${record.metrics?.expectedOutcomeMet ? "met" : "miss"}`,
      );
    } else {
      contaminated.push(record);
      console.log(
        `routing_trial: CONTAMINATED ${record.validity.reason}${record.validity.detail ? ` (${record.validity.detail})` : ""}`,
      );
    }
  }

  const repairModel =
    arm === "variant" ? ROUTING_REPAIR_CANDIDATE : ROUTING_DEFAULT_MODEL;
  const routingReason: RoutingReason =
    arm === "variant" ? "repair_override" : "default";
  const sloMet =
    valid.length === ROUTING_VALID_TRIALS_PER_ARM
      ? valid.every((trial) => trial.metrics?.expectedOutcomeMet === true)
      : null;

  return {
    id: arm,
    label: arm === "baseline" ? "BASELINE — Luna repair" : "VARIANT — Terra repair",
    repairModel,
    routingReason,
    attemptedTrials: attempt,
    validTrials: valid.length,
    sloMet,
    trials: valid,
    contaminated,
    averages: averageMetrics(valid),
  };
}

function toTrialRecord(
  deps: RoutingExperimentDeps,
  arm: RoutingArmId,
  attempt: number,
  probe: RoutingProbeAttempt,
): RoutingTrialRecord {
  const validity = assessRoutingTrialValidity(evidenceFromProbeAttempt(probe));
  const result = probe.result;
  if (!validity.valid || !result) {
    return {
      arm,
      attempt,
      valid: false,
      validity,
      runId: result ? runIdFromTrace(result.tracePath) : null,
      tracePath: result?.tracePath ?? null,
      metrics: null,
    };
  }

  const routing = extractRepairRouting(result, arm);
  return {
    arm,
    attempt,
    valid: true,
    validity,
    runId: runIdFromTrace(result.tracePath),
    tracePath: result.tracePath,
    metrics: trialMetrics(result, routing, deps.scoreExpected(result)),
  };
}

function extractRepairRouting(
  result: HarnessRunResult,
  arm: RoutingArmId,
): { model: string; reason: RoutingReason } {
  const fallback = {
    model: arm === "variant" ? ROUTING_REPAIR_CANDIDATE : ROUTING_DEFAULT_MODEL,
    reason: (arm === "variant" ? "repair_override" : "default") as RoutingReason,
  };
  if (!result.tracePath || !fs.existsSync(result.tracePath)) {
    return fallback;
  }

  for (const event of readJsonl(result.tracePath)) {
    if (event.event === "repair_started" && typeof event.model === "string") {
      return {
        model: event.model,
        reason: asRoutingReason(event.routingReason, fallback.reason),
      };
    }
    if (
      event.event === "model_call_started" &&
      event.episode === "repair" &&
      typeof event.model === "string"
    ) {
      return {
        model: event.model,
        reason: asRoutingReason(event.routingReason, fallback.reason),
      };
    }
  }
  return fallback;
}

function trialMetrics(
  result: HarnessRunResult,
  routing: { model: string; reason: RoutingReason },
  expectedOutcomeMet: boolean,
): RoutingTrialMetrics {
  const first = result.verifications[0];
  const second = result.verifications[1];
  const repair = result.repairs[0];
  const usage = result.contextMetrics.tokenUsage;
  return {
    repairModel: routing.model,
    routingReason: routing.reason,
    phase: "repair",
    expectedOutcomeMet,
    firstVerify: verifyLabel(first?.passed),
    secondVerify: verifyLabel(second?.passed),
    repairSuccess: second?.passed === true && result.repairAttempts === 1,
    eventualWorkflowSuccess: result.workflowStatus === "success",
    repeatedFailure: result.repeatedFailure,
    repairAttempts: result.repairAttempts,
    verificationAttempts: result.verificationAttempts,
    repairModelCalls: repair?.modelCalls ?? 0,
    repairToolCalls: repair?.toolCalls ?? 0,
    repairInputTokens: tokenField(usage, "repairInputTokens"),
    repairOutputTokens: tokenField(usage, "repairOutputTokens"),
    repairWallTimeMs: repair?.durationMs ?? null,
    workflowModelCalls: result.modelCalls,
    workflowInputTokens: usage?.totalInputTokens ?? null,
    workflowOutputTokens: usage?.totalOutputTokens ?? null,
    workflowWallTimeMs: result.durationMs,
  };
}

function averageMetrics(trials: RoutingTrialRecord[]): RoutingArmAverages {
  const metrics = trials
    .map((trial) => trial.metrics)
    .filter((item): item is RoutingTrialMetrics => item !== null);
  return {
    repairModelCalls: mean(metrics.map((item) => item.repairModelCalls)),
    repairToolCalls: mean(metrics.map((item) => item.repairToolCalls)),
    repairInputTokens: mean(metrics.map((item) => item.repairInputTokens)),
    repairOutputTokens: mean(metrics.map((item) => item.repairOutputTokens)),
    repairWallTimeMs: mean(metrics.map((item) => item.repairWallTimeMs)),
    workflowModelCalls: mean(metrics.map((item) => item.workflowModelCalls)),
    workflowInputTokens: mean(metrics.map((item) => item.workflowInputTokens)),
    workflowOutputTokens: mean(metrics.map((item) => item.workflowOutputTokens)),
    workflowWallTimeMs: mean(metrics.map((item) => item.workflowWallTimeMs)),
  };
}

export function formatRoutingReport(result: RoutingExperimentResult): string {
  return [
    `=== Model Routing Experiment (${result.experimentId}) ===`,
    "",
    `default_model: ${result.defaultModel}`,
    "axis: deterministic phase",
    "first_target_episode: repair",
    `quality_slo: ${result.qualitySlo}`,
    "policy_conclusion: not applied by this report",
    "",
    result.decisionRule,
    "",
    formatArm(result.baseline),
    "",
    formatArm(result.variant),
  ].join("\n");
}

function formatArm(arm: RoutingArmReport): string {
  const slo =
    arm.sloMet === null
      ? `insufficient valid trials (${arm.validTrials}/${ROUTING_VALID_TRIALS_PER_ARM})`
      : arm.sloMet
        ? "MET 3/3"
        : `MISS ${arm.trials.filter((trial) => trial.metrics?.expectedOutcomeMet).length}/${arm.validTrials}`;
  const lines = [
    arm.label,
    `repair_model: ${arm.repairModel}`,
    `routing_reason: ${arm.routingReason}`,
    `valid_trials: ${arm.validTrials} / attempted ${arm.attemptedTrials}`,
    `contaminated: ${arm.contaminated.length}`,
    `slo: ${slo}`,
  ];

  for (const trial of arm.trials) {
    const m = trial.metrics!;
    lines.push(
      `  valid#${trial.attempt} model=${m.repairModel} reason=${m.routingReason} phase=${m.phase} expected=${m.expectedOutcomeMet ? "yes" : "no"} verify=${m.firstVerify}→${m.secondVerify} repair_ok=${m.repairSuccess} workflow=${m.eventualWorkflowSuccess ? "success" : "fail"} repeated=${m.repeatedFailure} repair_attempts=${m.repairAttempts} verify_attempts=${m.verificationAttempts} repair_calls=${m.repairModelCalls}/${m.repairToolCalls} repair_tokens=${fmtNum(m.repairInputTokens)}/${fmtNum(m.repairOutputTokens)} repair_ms=${fmtNum(m.repairWallTimeMs)} workflow_calls=${m.workflowModelCalls} workflow_tokens=${fmtNum(m.workflowInputTokens)}/${fmtNum(m.workflowOutputTokens)} workflow_ms=${m.workflowWallTimeMs}`,
    );
  }
  for (const trial of arm.contaminated) {
    lines.push(
      `  contaminated#${trial.attempt} ${trial.validity.reason}${trial.validity.detail ? ` ${trial.validity.detail}` : ""}`,
    );
  }

  const avg = arm.averages;
  lines.push(
    `  averages: repair_calls=${fmtNum(avg.repairModelCalls)}/${fmtNum(avg.repairToolCalls)} repair_tokens=${fmtNum(avg.repairInputTokens)}/${fmtNum(avg.repairOutputTokens)} repair_ms=${fmtNum(avg.repairWallTimeMs)} workflow_calls=${fmtNum(avg.workflowModelCalls)} workflow_tokens=${fmtNum(avg.workflowInputTokens)}/${fmtNum(avg.workflowOutputTokens)} workflow_ms=${fmtNum(avg.workflowWallTimeMs)}`,
  );
  return lines.join("\n");
}

function copyTrialTraces(
  result: RoutingExperimentResult,
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

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip malformed trace lines
    }
  }
  return events;
}

function asRoutingReason(
  value: unknown,
  fallback: RoutingReason,
): RoutingReason {
  return value === "repair_override" || value === "default" ? value : fallback;
}

function verifyLabel(passed: boolean | undefined): "PASS" | "FAIL" | "missing" {
  if (passed === undefined) {
    return "missing";
  }
  return passed ? "PASS" : "FAIL";
}

function tokenField(
  usage: TokenUsageSummary | null | undefined,
  key: "repairInputTokens" | "repairOutputTokens",
): number | null {
  return usage?.[key] ?? null;
}

function mean(values: Array<number | null>): number | null {
  const nums = values.filter((value): value is number => value !== null);
  if (nums.length === 0) {
    return null;
  }
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function fmtNum(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function runIdFromTrace(tracePath: string): string {
  return path.basename(tracePath, ".jsonl");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
