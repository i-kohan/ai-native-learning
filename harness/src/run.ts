import type { HarnessConfig } from "./config.ts";
import {
  buildRepositoryMap,
  combineTokenUsage,
  computePathOverlap,
  type ContextMode,
  type ContextPreparation,
  type ContextRunMetrics,
  type InspectedPaths,
  type PhaseDiscoveryMetrics,
  type ReusableContext,
  type TokenUsageSummary,
} from "./context.ts";
import { diffSnapshots, snapshotDirectory, type FileSnapshot } from "./diff.ts";
import { normalizeFailure, type NormalizedFailure } from "./failure.ts";
import { runAgentLoop, type AgentRunResult } from "./loop.ts";
import { formatRepairContract, nextRepairDecision } from "./repair.ts";
import { buildSpec } from "./spec-phase.ts";
import {
  formatSpecContract,
  summarizeAmbiguities,
  writeSpecArtifact,
  type Ambiguity,
  type Spec,
  type SpecDecision,
} from "./spec.ts";
import { Tracer } from "./trace.ts";
import { runFinalVerification, type VerificationResult } from "./verify.ts";

export type WorkflowStatus = "success" | "failure" | "needs_human_judgment";

export type WorkflowFailureReason =
  | AgentRunResult["failureReason"]
  | "spec_phase_failed"
  | "final_verification_failed";

export type VerificationAttempt = {
  attempt: number;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  normalizedFailure: NormalizedFailure | null;
};

export type RepairAttemptSummary = {
  attempt: number;
  modelCalls: number;
  toolCalls: number;
  turns: number;
  receivedTerminalResponse: boolean;
  changedFiles: string[];
  durationMs: number;
  tokenUsage: TokenUsageSummary | null;
};

export type HarnessRunResult = {
  task: string;
  workflowStatus: WorkflowStatus;
  failureReason?: WorkflowFailureReason;
  specDecision: SpecDecision | null;
  unresolvedQuestions: Ambiguity[];
  implementationStarted: boolean;
  implementation: AgentRunResult | null;
  specTurns: number;
  specModelCalls: number;
  specToolCalls: number;
  turns: number;
  modelCalls: number;
  toolCalls: number;
  receivedTerminalResponse: boolean;
  verificationAttempts: number;
  repairAttempts: number;
  repeatedFailure: boolean;
  verifications: VerificationAttempt[];
  repairs: RepairAttemptSummary[];
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult | null;
  modelFinalResponse: string;
  changedFiles: string[];
  unifiedDiff: string;
  tracePath: string;
  specPath: string;
  durationMs: number;
  contextMode: ContextMode;
  contextMetrics: ContextRunMetrics;
};

export async function runV1Harness(options: {
  config: HarnessConfig;
  task: string;
  runId: string;
  beforeSnapshot?: FileSnapshot;
  contextMode?: ContextMode;
  /** Benchmark-only hook. Production runs must not pass this. */
  afterImplementationEpisode?: () => void;
}): Promise<HarnessRunResult> {
  const { config, task, runId } = options;
  const contextMode = options.contextMode ?? "baseline";
  const startedAt = Date.now();
  const tracer = new Tracer(config.tracesDir, runId);
  const beforeSnapshot =
    options.beforeSnapshot ?? snapshotDirectory(config.targetSrcRoot);

  let contextPreparation: ContextPreparation | null = null;
  let repositoryMap: ReusableContext["repositoryMap"] | undefined;

  if (contextMode === "variant") {
    contextPreparation = buildRepositoryMap(config);
    repositoryMap = contextPreparation.map;
    tracer.record("context_prepared", {
      contextMode,
      durationMs: contextPreparation.durationMs,
      pathsScanned: contextPreparation.pathsScanned,
      mapEntryCount: contextPreparation.map.entries.length,
    });
  }

  tracer.record("run_started", {
    version: "v2",
    task,
    model: config.model,
    maxTurns: config.maxTurns,
    maxRepairAttempts: config.maxRepairAttempts,
    contextMode,
  });

  const specPhase = await buildSpec({
    config,
    task,
    tracer,
    contextMode,
    repositoryMap,
  });

  if (!specPhase.decision) {
    const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
    const { changedFiles, unifiedDiff } = diffSnapshots(
      beforeSnapshot,
      afterSnapshot,
    );
    const result = baseResult({
      task,
      workflowStatus: "failure",
      failureReason: "spec_phase_failed",
      specDecision: null,
      unresolvedQuestions: [],
      implementationStarted: false,
      implementation: null,
      specPhase,
      contextMode,
      contextPreparation,
      receivedTerminalResponse: false,
      verificationAttempts: 0,
      repairAttempts: 0,
      repeatedFailure: false,
      verifications: [],
      repairs: [],
      finalVerificationPassed: false,
      finalVerification: null,
      modelFinalResponse: specPhase.modelFinalResponse,
      changedFiles,
      unifiedDiff,
      tracePath: tracer.tracePath,
      durationMs: Date.now() - startedAt,
    });
    tracer.record("harness_gate", {
      action: "abort",
      reason: specPhase.failureReason ?? "spec_phase_failed",
    });
    await finishRun(tracer, result);
    return result;
  }

  const decision = specPhase.decision;

  if (decision.status === "needs_human_judgment") {
    const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
    const { changedFiles, unifiedDiff } = diffSnapshots(
      beforeSnapshot,
      afterSnapshot,
    );
    tracer.record("harness_gate", {
      action: "escalate",
      unresolvedQuestions: decision.unresolvedQuestions,
      implementationStarted: false,
    });
    const result = baseResult({
      task,
      workflowStatus: "needs_human_judgment",
      specDecision: decision,
      unresolvedQuestions: decision.unresolvedQuestions,
      implementationStarted: false,
      implementation: null,
      specPhase,
      contextMode,
      contextPreparation,
      receivedTerminalResponse: false,
      verificationAttempts: 0,
      repairAttempts: 0,
      repeatedFailure: false,
      verifications: [],
      repairs: [],
      finalVerificationPassed: false,
      finalVerification: null,
      modelFinalResponse: formatEscalationMessage(decision),
      changedFiles,
      unifiedDiff,
      tracePath: tracer.tracePath,
      durationMs: Date.now() - startedAt,
    });
    await finishRun(tracer, result);
    return result;
  }

  tracer.record("harness_gate", {
    action: "execute",
    implementationStarted: true,
  });

  const reusableContext: ReusableContext | undefined =
    contextMode === "variant" && repositoryMap
      ? {
          repositoryMap,
          specInspectedPaths: specPhase.inspectedPaths,
        }
      : undefined;

  const implementation = await runAgentLoop({
    config,
    task: formatSpecContract(task, decision.spec),
    runId,
    beforeSnapshot,
    spec: decision.spec,
    tracer,
    reusableContext,
    phase: "implementation",
  });

  tracer.record("implementation_completed", {
    episodeStatus: implementation.status,
    receivedTerminalResponse: implementation.receivedTerminalResponse,
    modelCalls: implementation.modelCalls,
    toolCalls: implementation.toolCalls,
    changedFiles: implementation.changedFiles,
    durationMs: implementation.durationMs,
  });

  if (options.afterImplementationEpisode) {
    options.afterImplementationEpisode();
  }

  const verified = await runVerifyRepairLoop({
    config,
    task,
    spec: decision.spec,
    tracer,
    reusableContext,
    runId,
    implementation,
  });

  const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
  const { changedFiles, unifiedDiff } = diffSnapshots(
    beforeSnapshot,
    afterSnapshot,
  );

  const result = baseResult({
    task,
    workflowStatus: verified.workflowStatus,
    failureReason: verified.failureReason,
    specDecision: decision,
    unresolvedQuestions: [],
    implementationStarted: true,
    implementation,
    specPhase,
    contextMode,
    contextPreparation,
    receivedTerminalResponse: implementation.receivedTerminalResponse,
    verificationAttempts: verified.verificationAttempts,
    repairAttempts: verified.repairAttempts,
    repeatedFailure: verified.repeatedFailure,
    verifications: verified.verifications,
    repairs: verified.repairs,
    finalVerificationPassed: verified.finalVerificationPassed,
    finalVerification: verified.finalVerification,
    modelFinalResponse: verified.modelFinalResponse,
    changedFiles,
    unifiedDiff,
    tracePath: tracer.tracePath,
    durationMs: Date.now() - startedAt,
  });
  await finishRun(tracer, result);
  return result;
}

export function printHarnessResult(result: HarnessRunResult): void {
  console.log("\n=== V2 Harness Result ===");
  console.log(`task: ${truncate(result.task, 200)}`);
  console.log(`workflow_status: ${result.workflowStatus}`);
  console.log(`spec_decision: ${result.specDecision?.status ?? "(none)"}`);
  console.log(`implementation_started: ${result.implementationStarted}`);
  if (result.failureReason) {
    console.log(`failure_reason: ${result.failureReason}`);
  }
  const ambiguities = result.specDecision
    ? summarizeAmbiguities(result.specDecision.spec)
    : [];
  console.log(
    `ambiguities: ${
      ambiguities.length
        ? ambiguities
            .map((item) => `${item.classification}/${item.status}`)
            .join(", ")
        : "(none)"
    }`,
  );
  if (result.specDecision) {
    const spec = result.specDecision.spec;
    console.log("--- spec ---");
    console.log(`goal: ${spec.goal}`);
    printList("requirements", spec.requirements);
    printList("constraints", spec.constraints);
    printList("non_goals", spec.nonGoals);
    printList("acceptance", spec.acceptance);
    printList("verification", spec.verification);
    if (spec.ambiguities.length) {
      console.log("ambiguity_details:");
      for (const item of spec.ambiguities) {
        console.log(
          `- [${item.classification}/${item.status}] ${item.question}`,
        );
        if (item.resolution) {
          console.log(`  resolution: ${item.resolution}`);
        }
        if (item.basis) {
          console.log(`  basis: ${item.basis}`);
        }
      }
    }
    console.log("--- end spec ---");
  }
  if (result.unresolvedQuestions.length) {
    console.log("unresolved_questions:");
    for (const question of result.unresolvedQuestions) {
      console.log(`- ${question.question}`);
      console.log(`  classification: ${question.classification}`);
      if (question.basis) {
        console.log(`  basis: ${question.basis}`);
      }
    }
  }
  console.log(
    `turns/model_calls: ${result.turns}/${result.modelCalls} (spec ${result.specTurns}/${result.specModelCalls})`,
  );
  console.log(`tool_calls: ${result.toolCalls} (spec ${result.specToolCalls})`);
  console.log(
    `verification_attempts: ${result.verificationAttempts} | repair_attempts: ${result.repairAttempts} | repeated_failure: ${result.repeatedFailure}`,
  );
  if (result.verifications.length) {
    console.log(
      `verifications: ${result.verifications
        .map(
          (item) =>
            `#${item.attempt}=${item.passed ? "PASS" : "FAIL"}(exit ${item.exitCode})`,
        )
        .join(", ")}`,
    );
  }
  if (result.implementationStarted) {
    console.log(
      `final_tests: ${result.finalVerificationPassed ? "PASS" : "FAIL"} (exit ${result.finalVerification?.exitCode ?? "n/a"})`,
    );
    console.log(
      `received_terminal_response: ${result.receivedTerminalResponse}`,
    );
  } else {
    console.log("final_tests: (skipped — implementation not started)");
  }
  console.log(
    `changed_files: ${result.changedFiles.length ? result.changedFiles.join(", ") : "(none)"}`,
  );
  if (result.unifiedDiff.trim()) {
    console.log("--- diff ---");
    console.log(result.unifiedDiff);
    console.log("--- end diff ---");
  }
  console.log(`trace: ${result.tracePath}`);
  console.log(`spec: ${result.specPath}`);
  console.log(`duration_ms: ${result.durationMs}`);
  console.log(`context_mode: ${result.contextMode}`);
  printContextMetrics(result.contextMetrics);
  console.log(`model_final_response:\n${result.modelFinalResponse}`);
}

function printContextMetrics(metrics: ContextRunMetrics): void {
  if (metrics.preparation) {
    console.log(
      `context_prep: ${metrics.preparation.durationMs}ms scanned=${metrics.preparation.pathsScanned} entries=${metrics.preparation.map.entries.length}`,
    );
  }
  console.log(
    `spec_repo_tools: list_files=${metrics.specDiscovery.listFilesCalls} read_file=${metrics.specDiscovery.readFileCalls}`,
  );
  if (metrics.implDiscovery) {
    console.log(
      `impl_repo_tools: list_files=${metrics.implDiscovery.listFilesCalls} read_file=${metrics.implDiscovery.readFileCalls} nav_before_first_write=${metrics.implNavCallsBeforeFirstWrite ?? "n/a"}`,
    );
  }
  if (metrics.pathOverlap) {
    console.log(
      `path_overlap: read_file=${metrics.pathOverlap.readFileOverlap.join(", ") || "(none)"} list_files=${metrics.pathOverlap.listedPathOverlap.join(", ") || "(none)"}`,
    );
  }
  if (metrics.tokenUsage) {
    const usage = metrics.tokenUsage;
    console.log(
      `tokens: in=${usage.totalInputTokens ?? "n/a"} out=${usage.totalOutputTokens ?? "n/a"} (spec in=${usage.specInputTokens ?? "n/a"} out=${usage.specOutputTokens ?? "n/a"}; impl in=${usage.implInputTokens ?? "n/a"} out=${usage.implOutputTokens ?? "n/a"}; repair in=${usage.repairInputTokens ?? "n/a"} out=${usage.repairOutputTokens ?? "n/a"})`,
    );
  }
}

function formatEscalationMessage(
  decision: Extract<SpecDecision, { status: "needs_human_judgment" }>,
): string {
  const questions = decision.unresolvedQuestions
    .map((item) => `- ${item.question}`)
    .join("\n");
  return [
    "Escalated: needs_human_judgment. Implementation loop was not started.",
    questions || "- (unresolved product question not listed in ambiguities)",
  ].join("\n");
}

async function runVerifyRepairLoop(options: {
  config: HarnessConfig;
  task: string;
  spec: Spec;
  tracer: Tracer;
  reusableContext: ReusableContext | undefined;
  runId: string;
  implementation: AgentRunResult;
}): Promise<{
  workflowStatus: WorkflowStatus;
  failureReason?: WorkflowFailureReason;
  verificationAttempts: number;
  repairAttempts: number;
  repeatedFailure: boolean;
  verifications: VerificationAttempt[];
  repairs: RepairAttemptSummary[];
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult | null;
  modelFinalResponse: string;
}> {
  const { config, task, spec, tracer, reusableContext, runId, implementation } =
    options;

  const verifications: VerificationAttempt[] = [];
  const repairs: RepairAttemptSummary[] = [];
  let repairAttempts = 0;
  let repeatedFailure = false;
  let previousSignature: string | null = null;
  let lastRepairChangedFiles = false;
  let lastVerification: VerificationResult | null = null;
  let modelFinalResponse = implementation.modelFinalResponse;
  let failureReason: WorkflowFailureReason | undefined =
    implementation.failureReason;

  if (implementation.failureReason === "model_error") {
    tracer.record("workflow_outcome", {
      status: "failure",
      reason: "model_error",
      verificationAttempts: 0,
      repairAttempts: 0,
    });
    return {
      workflowStatus: "failure",
      failureReason: "model_error",
      verificationAttempts: 0,
      repairAttempts: 0,
      repeatedFailure: false,
      verifications,
      repairs,
      finalVerificationPassed: false,
      finalVerification: null,
      modelFinalResponse,
    };
  }

  while (true) {
    const verification = runFinalVerification(config);
    lastVerification = verification;
    const attempt = verifications.length + 1;
    const normalized = verification.passed
      ? null
      : normalizeFailure(verification);
    verifications.push({
      attempt,
      passed: verification.passed,
      exitCode: verification.exitCode,
      durationMs: verification.durationMs,
      normalizedFailure: normalized,
    });

    tracer.record("verification_attempt", {
      attempt,
      passed: verification.passed,
      exitCode: verification.exitCode,
      durationMs: verification.durationMs,
      outputPreview: truncate(verification.output, 4000),
    });

    if (normalized) {
      tracer.record("failure_normalized", {
        attempt,
        failedTests: normalized.failedTests,
        locations: normalized.locations,
        assertionMessages: normalized.assertionMessages,
        summary: normalized.summary,
        signature: normalized.signature,
      });
    }

    const decision = nextRepairDecision({
      verificationPassed: verification.passed,
      repairAttemptsUsed: repairAttempts,
      maxRepairAttempts: config.maxRepairAttempts,
      currentFailureSignature: normalized?.signature ?? null,
      previousFailureSignature: previousSignature,
      lastRepairChangedFiles,
    });

    if (decision.action === "verified_success") {
      tracer.record("workflow_outcome", {
        status: "success",
        reason: "verified_success",
        verificationAttempts: attempt,
        repairAttempts,
      });
      return {
        workflowStatus: "success",
        verificationAttempts: attempt,
        repairAttempts,
        repeatedFailure: false,
        verifications,
        repairs,
        finalVerificationPassed: true,
        finalVerification: verification,
        modelFinalResponse,
      };
    }

    if (decision.action === "stop") {
      repeatedFailure = decision.repeatedFailure;
      failureReason = "final_verification_failed";
      tracer.record("workflow_outcome", {
        status: "failure",
        reason: decision.reason,
        verificationAttempts: attempt,
        repairAttempts,
        repeatedFailure,
      });
      return {
        workflowStatus: "failure",
        failureReason,
        verificationAttempts: attempt,
        repairAttempts,
        repeatedFailure,
        verifications,
        repairs,
        finalVerificationPassed: false,
        finalVerification: verification,
        modelFinalResponse,
      };
    }

    repairAttempts = decision.attempt;
    previousSignature = normalized?.signature ?? null;
    const repairBefore = snapshotDirectory(config.targetSrcRoot);

    tracer.record("repair_started", {
      attempt: repairAttempts,
      maxRepairAttempts: config.maxRepairAttempts,
      specGoal: spec.goal,
      failedTests: normalized?.failedTests ?? [],
      failureSignature: normalized?.signature ?? null,
      promptIncludesSpec: true,
      promptIncludesFailureEvidence: Boolean(normalized),
      promptPreview: truncate(
        formatRepairContract(task, spec, normalized!),
        2000,
      ),
    });

    const repair = await runAgentLoop({
      config,
      task: formatRepairContract(task, spec, normalized!),
      runId,
      beforeSnapshot: repairBefore,
      spec,
      tracer,
      reusableContext,
      phase: "repair",
    });

    lastRepairChangedFiles = repair.changedFiles.length > 0;
    modelFinalResponse = repair.modelFinalResponse;
    repairs.push({
      attempt: repairAttempts,
      modelCalls: repair.modelCalls,
      toolCalls: repair.toolCalls,
      turns: repair.turns,
      receivedTerminalResponse: repair.receivedTerminalResponse,
      changedFiles: repair.changedFiles,
      durationMs: repair.durationMs,
      tokenUsage: repair.tokenUsage,
    });

    tracer.record("repair_completed", {
      attempt: repairAttempts,
      episodeStatus: repair.status,
      receivedTerminalResponse: repair.receivedTerminalResponse,
      modelCalls: repair.modelCalls,
      toolCalls: repair.toolCalls,
      changedFiles: repair.changedFiles,
      durationMs: repair.durationMs,
      tokenUsage: repair.tokenUsage,
    });

    if (repair.failureReason === "model_error") {
      tracer.record("workflow_outcome", {
        status: "failure",
        reason: "model_error",
        verificationAttempts: attempt,
        repairAttempts,
      });
      return {
        workflowStatus: "failure",
        failureReason: "model_error",
        verificationAttempts: attempt,
        repairAttempts,
        repeatedFailure: false,
        verifications,
        repairs,
        finalVerificationPassed: false,
        finalVerification: lastVerification,
        modelFinalResponse,
      };
    }
  }
}

function baseResult(fields: {
  task: string;
  workflowStatus: WorkflowStatus;
  failureReason?: HarnessRunResult["failureReason"];
  specDecision: SpecDecision | null;
  unresolvedQuestions: Ambiguity[];
  implementationStarted: boolean;
  implementation: AgentRunResult | null;
  specPhase: {
    turns: number;
    modelCalls: number;
    toolCalls: number;
    inspectedPaths: InspectedPaths;
    discovery: PhaseDiscoveryMetrics;
    tokenUsage: TokenUsageSummary | null;
  };
  contextMode: ContextMode;
  contextPreparation: ContextPreparation | null;
  receivedTerminalResponse: boolean;
  verificationAttempts: number;
  repairAttempts: number;
  repeatedFailure: boolean;
  verifications: VerificationAttempt[];
  repairs: RepairAttemptSummary[];
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult | null;
  modelFinalResponse: string;
  changedFiles: string[];
  unifiedDiff: string;
  tracePath: string;
  durationMs: number;
}): HarnessRunResult {
  const implementation = fields.implementation;
  const implDiscovery = implementation?.discovery ?? null;
  const pathOverlap =
    implDiscovery !== null
      ? computePathOverlap(fields.specPhase.inspectedPaths, {
          readFiles: implDiscovery.readFilePaths,
          listedPaths: implDiscovery.listedPaths,
        })
      : null;

  const repairTokenUsage = fields.repairs.map((item) => item.tokenUsage);

  const contextMetrics: ContextRunMetrics = {
    mode: fields.contextMode,
    preparation: fields.contextPreparation,
    specDiscovery: fields.specPhase.discovery,
    implDiscovery,
    pathOverlap,
    implNavCallsBeforeFirstWrite:
      implementation?.implNavCallsBeforeFirstWrite ?? null,
    tokenUsage: combineTokenUsage(
      fields.specPhase.tokenUsage,
      implementation?.tokenUsage ?? null,
      ...repairTokenUsage,
    ),
  };

  const repairTurns = fields.repairs.reduce((sum, item) => sum + item.turns, 0);
  const repairModelCalls = fields.repairs.reduce(
    (sum, item) => sum + item.modelCalls,
    0,
  );
  const repairToolCalls = fields.repairs.reduce(
    (sum, item) => sum + item.toolCalls,
    0,
  );

  return {
    task: fields.task,
    workflowStatus: fields.workflowStatus,
    failureReason: fields.failureReason,
    specDecision: fields.specDecision,
    unresolvedQuestions: fields.unresolvedQuestions,
    implementationStarted: fields.implementationStarted,
    implementation,
    specTurns: fields.specPhase.turns,
    specModelCalls: fields.specPhase.modelCalls,
    specToolCalls: fields.specPhase.toolCalls,
    turns: fields.specPhase.turns + (implementation?.turns ?? 0) + repairTurns,
    modelCalls:
      fields.specPhase.modelCalls +
      (implementation?.modelCalls ?? 0) +
      repairModelCalls,
    toolCalls:
      fields.specPhase.toolCalls +
      (implementation?.toolCalls ?? 0) +
      repairToolCalls,
    receivedTerminalResponse: fields.receivedTerminalResponse,
    verificationAttempts: fields.verificationAttempts,
    repairAttempts: fields.repairAttempts,
    repeatedFailure: fields.repeatedFailure,
    verifications: fields.verifications,
    repairs: fields.repairs,
    finalVerificationPassed: fields.finalVerificationPassed,
    finalVerification: fields.finalVerification,
    modelFinalResponse: fields.modelFinalResponse,
    changedFiles: fields.changedFiles,
    unifiedDiff: fields.unifiedDiff,
    tracePath: fields.tracePath,
    specPath: "",
    durationMs: fields.durationMs,
    contextMode: fields.contextMode,
    contextMetrics,
  };
}

async function finishRun(
  tracer: Tracer,
  result: HarnessRunResult,
): Promise<void> {
  result.specPath = writeSpecArtifact(tracer.tracePath, {
    task: result.task,
    decision: result.specDecision?.status ?? null,
    spec: result.specDecision?.spec ?? null,
    unresolvedQuestions: result.unresolvedQuestions,
    implementationStarted: result.implementationStarted,
    workflowStatus: result.workflowStatus,
  });
  tracer.record("run_completed", {
    version: "v2",
    workflowStatus: result.workflowStatus,
    specDecision: result.specDecision?.status ?? null,
    spec: result.specDecision?.spec ?? null,
    specPath: result.specPath,
    implementationStarted: result.implementationStarted,
    failureReason: result.failureReason ?? null,
    unresolvedQuestions: result.unresolvedQuestions,
    turns: result.turns,
    modelCalls: result.modelCalls,
    toolCalls: result.toolCalls,
    specModelCalls: result.specModelCalls,
    specToolCalls: result.specToolCalls,
    receivedTerminalResponse: result.receivedTerminalResponse,
    verificationAttempts: result.verificationAttempts,
    repairAttempts: result.repairAttempts,
    repeatedFailure: result.repeatedFailure,
    verifications: result.verifications.map((item) => ({
      attempt: item.attempt,
      passed: item.passed,
      exitCode: item.exitCode,
      durationMs: item.durationMs,
      failedTests: item.normalizedFailure?.failedTests ?? [],
      signature: item.normalizedFailure?.signature ?? null,
    })),
    repairs: result.repairs,
    finalVerificationPassed: result.finalVerificationPassed,
    changedFiles: result.changedFiles,
    durationMs: result.durationMs,
    contextMode: result.contextMode,
    contextMetrics: result.contextMetrics,
  });
  await tracer.close();
}

function printList(label: string, items: string[]): void {
  if (!items.length) {
    console.log(`${label}: (none)`);
    return;
  }
  console.log(`${label}:`);
  for (const item of items) {
    console.log(`- ${item}`);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}
