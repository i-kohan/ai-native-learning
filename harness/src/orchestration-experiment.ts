import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.ts";
import type { ConversationStateMode } from "./loop.ts";
import type { HarnessRunResult } from "./run.ts";

export const ORCHESTRATION_EXPERIMENT_ID = "m11-conversation-state";
export const ORCHESTRATION_TASK_ID = "T02";
export const ORCHESTRATION_CONTEXT_MODE = "variant";
export const ORCHESTRATION_TRIALS_PER_ARM = 3;

export type OrchestrationArmId = ConversationStateMode;

export type OrchestrationTrialMetrics = {
  conversationStateMode: ConversationStateMode;
  expectedOutcomeMet: boolean;
  workflowStatus: HarnessRunResult["workflowStatus"];
  finalVerification: "PASS" | "FAIL" | "skipped";
  modelCalls: number;
  toolCalls: number;
  implementationTurns: number;
  clientInputItemsSent: number;
  clientInputBytesSent: number;
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number;
  changedFiles: string[];
  chain: ConversationChainEvidence;
};

export type ConversationCallEvidence = {
  turn: number;
  phase: string | null;
  responseId: string | null;
  previousResponseId: string | null;
  clientInputItemCount: number | null;
  clientInputBytes: number | null;
};

export type ConversationChainEvidence = {
  calls: ConversationCallEvidence[];
  firstTurnHasNoPreviousId: boolean;
  subsequentTurnsChainPreviousId: boolean;
  variantSendsOnlyNewItems: boolean | null;
  toolCallEvents: number;
  replayGone: boolean | null;
};

export type OrchestrationTrialRecord = {
  arm: OrchestrationArmId;
  attempt: number;
  runId: string;
  tracePath: string;
  metrics: OrchestrationTrialMetrics;
};

export type OrchestrationArmAverages = {
  modelCalls: number | null;
  toolCalls: number | null;
  implementationTurns: number | null;
  clientInputItemsSent: number | null;
  clientInputBytesSent: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number | null;
};

export type OrchestrationArmReport = {
  id: OrchestrationArmId;
  label: string;
  conversationStateMode: ConversationStateMode;
  trials: OrchestrationTrialRecord[];
  expectedMet: number;
  averages: OrchestrationArmAverages;
};

export type OrchestrationDecision = {
  variantCorrect3of3: boolean;
  variantReplayGone: boolean;
  toolObservabilityIntact: boolean;
  clientReplayMateriallyDecreased: boolean;
  /** Token/latency comparison is not decided from n=3 without a predefined bar. */
  noClearRegression: "inconclusive";
  passed: boolean;
  notes: string[];
};

export type OrchestrationExperimentResult = {
  experimentId: string;
  generatedAt: string;
  taskId: typeof ORCHESTRATION_TASK_ID;
  contextMode: typeof ORCHESTRATION_CONTEXT_MODE;
  hypothesis: string;
  decisionRule: string;
  manual: OrchestrationArmReport;
  previousResponseId: OrchestrationArmReport;
  decision: OrchestrationDecision;
  report: string;
};

export type OrchestrationExperimentDeps = {
  runTrial: (
    arm: OrchestrationArmId,
    runId: string,
  ) => Promise<HarnessRunResult>;
  scoreExpected: (result: HarnessRunResult) => boolean;
};

const HYPOTHESIS =
  "Using previous_response_id instead of manual full Responses-history replay inside a bounded agent episode can preserve correctness, security and outer workflow semantics while reducing client-owned conversation-state plumbing/replay.";

const DECISION_RULE = [
  "Variant is a candidate to adopt only if:",
  "1. previous_response_id arm is 3/3 correct on T02.",
  "2. Client-side full-history replay is actually gone in variant.",
  "3. Existing tool/workspace/security authority is unchanged (by construction).",
  "4. Tool-call observability remains intact.",
  "5. Client conversation replay/items/bytes materially decrease.",
  "6. There is no clear repeated token/latency/failure regression.",
].join("\n");

export async function runOrchestrationExperiment(
  deps: OrchestrationExperimentDeps,
): Promise<OrchestrationExperimentResult> {
  const generatedAt = new Date().toISOString();
  const manual = await collectArm(deps, "manual");
  const previousResponseId = await collectArm(deps, "previous_response_id");
  const result: OrchestrationExperimentResult = {
    experimentId: ORCHESTRATION_EXPERIMENT_ID,
    generatedAt,
    taskId: ORCHESTRATION_TASK_ID,
    contextMode: ORCHESTRATION_CONTEXT_MODE,
    hypothesis: HYPOTHESIS,
    decisionRule: DECISION_RULE,
    manual,
    previousResponseId,
    decision: evaluateDecision(manual, previousResponseId),
    report: "",
  };
  result.report = formatOrchestrationReport(result);
  return result;
}

export function writeOrchestrationExperimentArtifact(
  result: OrchestrationExperimentResult,
): { jsonPath: string; reportPath: string; lessonDir: string } {
  const stamp = result.generatedAt.replace(/[:.]/g, "-");
  const evalsDir = path.join(REPO_ROOT, "evals");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/11-modern-model-native-orchestration/traces",
  );
  fs.mkdirSync(evalsDir, { recursive: true });
  fs.mkdirSync(lessonDir, { recursive: true });

  const jsonName = `orchestration-m11-${stamp}.json`;
  const reportName = `orchestration-m11-${stamp}.txt`;
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

export function inspectConversationChain(
  tracePath: string,
  mode: ConversationStateMode,
): ConversationChainEvidence {
  const events = readJsonl(tracePath);
  const started: ConversationCallEvidence[] = [];
  const completedByTurn = new Map<number, string>();
  let toolCallEvents = 0;

  for (const event of events) {
    if (event.event === "tool_call") {
      toolCallEvents += 1;
    }
    if (
      event.event === "model_call_completed" &&
      typeof event.turn === "number" &&
      typeof event.responseId === "string"
    ) {
      completedByTurn.set(event.turn, event.responseId);
    }
    if (
      event.event !== "model_call_started" ||
      event.phase !== "implementation"
    ) {
      continue;
    }
    started.push({
      turn: typeof event.turn === "number" ? event.turn : started.length + 1,
      phase: typeof event.phase === "string" ? event.phase : null,
      responseId: null,
      previousResponseId:
        event.previousResponseId === null ||
        typeof event.previousResponseId === "string"
          ? (event.previousResponseId as string | null)
          : null,
      clientInputItemCount:
        typeof event.clientInputItemCount === "number"
          ? event.clientInputItemCount
          : null,
      clientInputBytes:
        typeof event.clientInputBytes === "number"
          ? event.clientInputBytes
          : null,
    });
  }

  for (const call of started) {
    call.responseId = completedByTurn.get(call.turn) ?? null;
  }

  const firstTurnHasNoPreviousId =
    started.length === 0 || started[0].previousResponseId === null;

  let subsequentTurnsChainPreviousId = true;
  for (let index = 1; index < started.length; index += 1) {
    const previousId = started[index - 1].responseId;
    if (!previousId || started[index].previousResponseId !== previousId) {
      subsequentTurnsChainPreviousId = false;
      break;
    }
  }
  if (started.length < 2) {
    subsequentTurnsChainPreviousId = true;
  }

  const laterHavePreviousId = started
    .slice(1)
    .every((call) => call.previousResponseId !== null);
  const variantSendsOnlyNewItems =
    mode !== "previous_response_id"
      ? null
      : laterHavePreviousId && subsequentTurnsChainPreviousId;

  const replayGone =
    mode !== "previous_response_id"
      ? null
      : firstTurnHasNoPreviousId &&
        subsequentTurnsChainPreviousId &&
        variantSendsOnlyNewItems === true;

  return {
    calls: started,
    firstTurnHasNoPreviousId,
    subsequentTurnsChainPreviousId,
    variantSendsOnlyNewItems,
    toolCallEvents,
    replayGone,
  };
}

export function evaluateDecision(
  manual: OrchestrationArmReport,
  previousResponseId: OrchestrationArmReport,
): OrchestrationDecision {
  const notes: string[] = [];
  const variantCorrect3of3 =
    previousResponseId.trials.length === ORCHESTRATION_TRIALS_PER_ARM &&
    previousResponseId.expectedMet === ORCHESTRATION_TRIALS_PER_ARM;
  if (!variantCorrect3of3) {
    notes.push(
      `variant expected ${previousResponseId.expectedMet}/${ORCHESTRATION_TRIALS_PER_ARM}`,
    );
  }

  const variantReplayGone = previousResponseId.trials.every(
    (trial) => trial.metrics.chain.replayGone === true,
  );
  if (!variantReplayGone) {
    notes.push(
      "variant traces do not show previous_response_id chaining / replay gone",
    );
  }

  const toolObservabilityIntact = [
    ...manual.trials,
    ...previousResponseId.trials,
  ].every((trial) => trial.metrics.chain.toolCallEvents > 0);
  if (!toolObservabilityIntact) {
    notes.push("tool_call events missing on at least one trial");
  }

  const manualItems = manual.averages.clientInputItemsSent;
  const variantItems = previousResponseId.averages.clientInputItemsSent;
  const manualBytes = manual.averages.clientInputBytesSent;
  const variantBytes = previousResponseId.averages.clientInputBytesSent;
  const clientReplayMateriallyDecreased =
    manualItems !== null &&
    variantItems !== null &&
    manualBytes !== null &&
    variantBytes !== null &&
    variantItems < manualItems &&
    variantBytes < manualBytes;
  if (!clientReplayMateriallyDecreased) {
    notes.push("client input items/bytes did not materially decrease");
  }

  const manualExpected = manual.expectedMet === ORCHESTRATION_TRIALS_PER_ARM;
  if (!manualExpected) {
    notes.push(
      `manual arm expected ${manual.expectedMet}/${ORCHESTRATION_TRIALS_PER_ARM}`,
    );
  }

  const noClearRegression = "inconclusive" as const;
  notes.push(
    "criterion 6 inconclusive: n=3 is too small to judge token/latency; no predefined threshold",
  );

  const passed = false;

  return {
    variantCorrect3of3,
    variantReplayGone,
    toolObservabilityIntact,
    clientReplayMateriallyDecreased,
    noClearRegression,
    passed,
    notes,
  };
}

export function formatOrchestrationReport(
  result: OrchestrationExperimentResult,
): string {
  return [
    `=== Conversation-State Experiment (${result.experimentId}) ===`,
    "",
    `task: ${result.taskId}`,
    `context_mode: ${result.contextMode} (constant; not the experiment axis)`,
    `hypothesis: ${result.hypothesis}`,
    "",
    result.decisionRule,
    "",
    formatArm(result.manual),
    "",
    formatArm(result.previousResponseId),
    "",
    "Decision",
    `variant_3/3: ${result.decision.variantCorrect3of3 ? "yes" : "no"}`,
    `replay_gone: ${result.decision.variantReplayGone ? "yes" : "no"}`,
    `tool_observability: ${result.decision.toolObservabilityIntact ? "yes" : "no"}`,
    `client_replay_decreased: ${result.decision.clientReplayMateriallyDecreased ? "yes" : "no"}`,
    `no_clear_regression: ${result.decision.noClearRegression}`,
    `candidate_to_adopt: ${result.decision.passed ? "yes" : "no"}`,
    ...(result.decision.notes.length
      ? result.decision.notes.map((note) => `note: ${note}`)
      : []),
  ].join("\n");
}

async function collectArm(
  deps: OrchestrationExperimentDeps,
  arm: OrchestrationArmId,
): Promise<OrchestrationArmReport> {
  const trials: OrchestrationTrialRecord[] = [];
  for (let attempt = 1; attempt <= ORCHESTRATION_TRIALS_PER_ARM; attempt += 1) {
    const runId = `T02-orch-${arm}-${attempt}-${timestamp()}`;
    console.log(`\n=== Orchestration ${arm} trial ${attempt} (${runId}) ===`);
    const result = await deps.runTrial(arm, runId);
    const expected = deps.scoreExpected(result);
    const chain = inspectConversationChain(result.tracePath, arm);
    trials.push({
      arm,
      attempt,
      runId: runIdFromTrace(result.tracePath),
      tracePath: result.tracePath,
      metrics: trialMetrics(result, arm, expected, chain),
    });
    console.log(
      `orchestration_trial: expected=${expected ? "yes" : "no"} items=${result.clientInputItemsSent} bytes=${result.clientInputBytesSent}`,
    );
  }

  return {
    id: arm,
    label:
      arm === "manual"
        ? "ARM A — manual full-history replay"
        : "ARM B — previous_response_id",
    conversationStateMode: arm,
    trials,
    expectedMet: trials.filter((trial) => trial.metrics.expectedOutcomeMet)
      .length,
    averages: averageMetrics(trials),
  };
}

function trialMetrics(
  result: HarnessRunResult,
  mode: ConversationStateMode,
  expectedOutcomeMet: boolean,
  chain: ConversationChainEvidence,
): OrchestrationTrialMetrics {
  const usage = result.contextMetrics.tokenUsage;
  return {
    conversationStateMode: mode,
    expectedOutcomeMet,
    workflowStatus: result.workflowStatus,
    finalVerification: result.implementationStarted
      ? result.finalVerificationPassed
        ? "PASS"
        : "FAIL"
      : "skipped",
    modelCalls: result.modelCalls,
    toolCalls: result.toolCalls,
    implementationTurns: result.implementation?.turns ?? 0,
    clientInputItemsSent: result.clientInputItemsSent,
    clientInputBytesSent: result.clientInputBytesSent,
    inputTokens: usage?.totalInputTokens ?? null,
    outputTokens: usage?.totalOutputTokens ?? null,
    wallTimeMs: result.durationMs,
    changedFiles: result.changedFiles,
    chain,
  };
}

function averageMetrics(
  trials: OrchestrationTrialRecord[],
): OrchestrationArmAverages {
  const metrics = trials.map((trial) => trial.metrics);
  return {
    modelCalls: mean(metrics.map((item) => item.modelCalls)),
    toolCalls: mean(metrics.map((item) => item.toolCalls)),
    implementationTurns: mean(metrics.map((item) => item.implementationTurns)),
    clientInputItemsSent: mean(
      metrics.map((item) => item.clientInputItemsSent),
    ),
    clientInputBytesSent: mean(
      metrics.map((item) => item.clientInputBytesSent),
    ),
    inputTokens: mean(metrics.map((item) => item.inputTokens)),
    outputTokens: mean(metrics.map((item) => item.outputTokens)),
    wallTimeMs: mean(metrics.map((item) => item.wallTimeMs)),
  };
}

function formatArm(arm: OrchestrationArmReport): string {
  const lines = [
    arm.label,
    `conversation_state_mode: ${arm.conversationStateMode}`,
    `expected: ${arm.expectedMet}/${arm.trials.length}`,
  ];
  for (const trial of arm.trials) {
    const m = trial.metrics;
    lines.push(
      `  trial#${trial.attempt} expected=${m.expectedOutcomeMet ? "yes" : "no"} workflow=${m.workflowStatus} verify=${m.finalVerification} calls=${m.modelCalls} tools=${m.toolCalls} impl_turns=${m.implementationTurns} client_items=${m.clientInputItemsSent} client_bytes=${m.clientInputBytesSent} tokens=${fmtNum(m.inputTokens)}/${fmtNum(m.outputTokens)} wall_ms=${m.wallTimeMs} files=${m.changedFiles.join(",") || "(none)"} chain=${formatChain(m.chain)}`,
    );
  }
  const avg = arm.averages;
  lines.push(
    `  averages: calls=${fmtNum(avg.modelCalls)} tools=${fmtNum(avg.toolCalls)} impl_turns=${fmtNum(avg.implementationTurns)} client_items=${fmtNum(avg.clientInputItemsSent)} client_bytes=${fmtNum(avg.clientInputBytesSent)} tokens=${fmtNum(avg.inputTokens)}/${fmtNum(avg.outputTokens)} wall_ms=${fmtNum(avg.wallTimeMs)}`,
  );
  return lines.join("\n");
}

function formatChain(chain: ConversationChainEvidence): string {
  const ids = chain.calls
    .map((call) => {
      const prev = call.previousResponseId ?? "null";
      const id = call.responseId ?? "?";
      return `${call.turn}:${prev}->${id}[n=${call.clientInputItemCount ?? "?"}]`;
    })
    .join(" ");
  return ids || "(no impl model calls)";
}

function copyTrialTraces(
  result: OrchestrationExperimentResult,
  lessonDir: string,
): void {
  for (const trial of [
    ...result.manual.trials,
    ...result.previousResponseId.trials,
  ]) {
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
  if (!fs.existsSync(filePath)) {
    return events;
  }
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
