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
import {
  runAgentLoop,
  type AgentRunResult,
  type ConversationStateMode,
} from "./loop.ts";
import { formatRepairContract, nextRepairDecision } from "./repair.ts";
import {
  aggregateReviewState,
  decideFinding,
  emptyReviewRunState,
  formatReviewRepairContract,
  nextReviewDecision,
  shouldStartReview,
  type ArchitectureConstraint,
  type FindingDecisionRecord,
  type ReviewAttemptSummary,
  type ReviewContext,
  type ReviewRepairSummary,
  type ReviewRunState,
} from "./review.ts";
import { runIndependentReview } from "./review-phase.ts";
import type { SkillLoadRecord } from "./skills.ts";
import { buildSpec } from "./spec-phase.ts";
import {
  formatSpecContract,
  summarizeAmbiguities,
  writeSpecArtifact,
  type Ambiguity,
  type Spec,
  type SpecDecision,
} from "./spec.ts";
import { resolveModel, routingTraceFields } from "./model-routing.ts";
import { Tracer } from "./trace.ts";
import { runFinalVerification, type VerificationResult } from "./verify.ts";
import type { Workspace } from "./workspace.ts";

export type WorkflowStatus = "success" | "failure" | "needs_human_judgment";

export type WorkflowFailureReason =
  | AgentRunResult["failureReason"]
  | "spec_phase_failed"
  | "final_verification_failed"
  | "review_parse_failed"
  | "review_unresolved_blocker";

export function shouldVerifyAfterReviewRepair(
  failureReason: AgentRunResult["failureReason"],
): boolean {
  return failureReason !== "model_error";
}

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
  clientInputItemsSent?: number;
  clientInputBytesSent?: number;
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
  reviewAttempts: number;
  reviews: ReviewAttemptSummary[];
  reviewRepairAttempts: number;
  reviewRepairs: ReviewRepairSummary[];
  repeatedFinding: boolean;
  intendedFindingDetected: boolean;
  acceptedBlockingFindings: FindingDecisionRecord[];
  acceptedNonBlockingFindings: FindingDecisionRecord[];
  rejectedFindings: FindingDecisionRecord[];
  blockingFalsePositives: FindingDecisionRecord[];
  finalReviewerOutcome: ReviewRunState["finalReviewerOutcome"];
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult | null;
  modelFinalResponse: string;
  changedFiles: string[];
  unifiedDiff: string;
  tracePath: string;
  specPath: string;
  durationMs: number;
  contextMode: ContextMode;
  conversationStateMode: ConversationStateMode;
  clientInputItemsSent: number;
  clientInputBytesSent: number;
  contextMetrics: ContextRunMetrics;
  skillLoads: SkillLoadRecord[];
  workspace?: Workspace;
};

export async function runV1Harness(options: {
  config: HarnessConfig;
  task: string;
  runId: string;
  beforeSnapshot?: FileSnapshot;
  contextMode?: ContextMode;
  conversationStateMode?: ConversationStateMode;
  architectureConstraints?: ArchitectureConstraint[];
  /** Benchmark-only hook. Production runs must not pass this. */
  afterImplementationEpisode?: () => void;
  workspace?: Workspace;
}): Promise<HarnessRunResult> {
  const { config, task, runId } = options;
  const contextMode = options.contextMode ?? "baseline";
  const conversationStateMode: ConversationStateMode =
    options.conversationStateMode ?? "previous_response_id";
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
    version: "v3",
    task,
    model: config.model,
    repairModel: config.repairModel ?? null,
    maxTurns: config.maxTurns,
    maxRepairAttempts: config.maxRepairAttempts,
    maxReviewRepairAttempts: config.maxReviewRepairAttempts,
    contextMode,
    conversationStateMode,
    repoRoot: config.repoRoot,
    targetAppRoot: config.targetAppRoot,
    targetSrcRoot: config.targetSrcRoot,
    ...(options.workspace
      ? {
          workspace: {
            id: options.workspace.id,
            root: options.workspace.root,
            baseRevision: options.workspace.baseRevision,
            ref: options.workspace.ref,
          },
        }
      : {}),
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
      conversationStateMode,
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
      skillLoads: [],
      workspace: options.workspace,
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
      conversationStateMode,
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
      skillLoads: [],
      workspace: options.workspace,
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
    conversationStateMode,
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
    conversationStateMode,
    emitSuccessOutcome: false,
  });

  let workflowStatus = verified.workflowStatus;
  let failureReason = verified.failureReason;
  let modelFinalResponse = verified.modelFinalResponse;
  let verificationAttempts = verified.verificationAttempts;
  let repairAttempts = verified.repairAttempts;
  let repeatedFailure = verified.repeatedFailure;
  let verifications = verified.verifications;
  let repairs = verified.repairs;
  let finalVerificationPassed = verified.finalVerificationPassed;
  let finalVerification = verified.finalVerification;
  let reviewState = emptyReviewRunState();
  const skillLoads: SkillLoadRecord[] = [
    ...collectedSkillLoads(implementation),
    ...verified.skillLoads,
  ];

  const canReview =
    shouldStartReview(verified.finalVerificationPassed) &&
    verified.workflowStatus === "success";

  if (canReview) {
    const reviewed = await runIndependentReviewLoop({
      config,
      task,
      spec: decision.spec,
      tracer,
      reusableContext,
      runId,
      implementation,
      beforeSnapshot,
      architectureConstraints: options.architectureConstraints ?? [],
      lastVerification: verified.finalVerification!,
      lastVerificationAttempt: verified.verificationAttempts,
      conversationStateMode,
    });
    workflowStatus = reviewed.workflowStatus;
    failureReason = reviewed.failureReason;
    modelFinalResponse = reviewed.modelFinalResponse;
    verificationAttempts =
      verified.verificationAttempts + reviewed.extraVerificationAttempts;
    repairAttempts = verified.repairAttempts + reviewed.extraRepairAttempts;
    repeatedFailure = verified.repeatedFailure || reviewed.repeatedFailure;
    verifications = [...verified.verifications, ...reviewed.extraVerifications];
    repairs = [...verified.repairs, ...reviewed.extraRepairs];
    finalVerificationPassed = reviewed.finalVerificationPassed;
    finalVerification = reviewed.finalVerification;
    reviewState = reviewed.reviewState;
    skillLoads.push(...reviewed.skillLoads);
  } else if (verified.workflowStatus === "success") {
    tracer.record("workflow_outcome", {
      status: "success",
      reason: "verified_success",
      verificationAttempts: verified.verificationAttempts,
      repairAttempts: verified.repairAttempts,
      reviewSkipped: true,
    });
  }

  const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
  const { changedFiles, unifiedDiff } = diffSnapshots(
    beforeSnapshot,
    afterSnapshot,
  );

  const result = baseResult({
    task,
    workflowStatus,
    failureReason,
    specDecision: decision,
    unresolvedQuestions: [],
    implementationStarted: true,
    implementation,
    specPhase,
    contextMode,
    conversationStateMode,
    contextPreparation,
    receivedTerminalResponse: implementation.receivedTerminalResponse,
    verificationAttempts,
    repairAttempts,
    repeatedFailure,
    verifications,
    repairs,
    review: reviewState,
    finalVerificationPassed,
    finalVerification,
    modelFinalResponse,
    changedFiles,
    unifiedDiff,
    tracePath: tracer.tracePath,
    durationMs: Date.now() - startedAt,
    skillLoads,
    workspace: options.workspace,
  });
  await finishRun(tracer, result);
  return result;
}

export function printHarnessResult(result: HarnessRunResult): void {
  console.log("\n=== V3 Harness Result ===");
  console.log(`task: ${truncate(result.task, 200)}`);
  if (result.workspace) {
    console.log(
      `workspace: ${result.workspace.id} @ ${result.workspace.baseRevision.slice(0, 12)}`,
    );
    console.log(`workspace_root: ${result.workspace.root}`);
  }
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
  console.log(
    `review_attempts: ${result.reviewAttempts} | review_repair_attempts: ${result.reviewRepairAttempts} | reviewer: ${result.finalReviewerOutcome} | intended: ${result.intendedFindingDetected} | repeated_finding: ${result.repeatedFinding}`,
  );
  console.log(
    `review_findings: blocking=${result.acceptedBlockingFindings.length} non_blocking=${result.acceptedNonBlockingFindings.length} rejected=${result.rejectedFindings.length} blocking_fp=${result.blockingFalsePositives.length}`,
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
  console.log(`conversation_state_mode: ${result.conversationStateMode}`);
  console.log(
    `client_input: items=${result.clientInputItemsSent} bytes=${result.clientInputBytesSent}`,
  );
  printContextMetrics(result.contextMetrics);
  console.log(`skill_loads: ${formatSkillLoads(result.skillLoads)}`);
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
      `tokens: in=${usage.totalInputTokens ?? "n/a"} out=${usage.totalOutputTokens ?? "n/a"} (spec in=${usage.specInputTokens ?? "n/a"} out=${usage.specOutputTokens ?? "n/a"}; impl in=${usage.implInputTokens ?? "n/a"} out=${usage.implOutputTokens ?? "n/a"}; repair in=${usage.repairInputTokens ?? "n/a"} out=${usage.repairOutputTokens ?? "n/a"}; review in=${usage.reviewInputTokens ?? "n/a"} out=${usage.reviewOutputTokens ?? "n/a"}; review_repair in=${usage.reviewRepairInputTokens ?? "n/a"} out=${usage.reviewRepairOutputTokens ?? "n/a"})`,
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
  conversationStateMode: ConversationStateMode;
  emitSuccessOutcome?: boolean;
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
  skillLoads: SkillLoadRecord[];
}> {
  const { config, task, spec, tracer, reusableContext, runId, implementation } =
    options;
  const conversationStateMode = options.conversationStateMode;

  const verifications: VerificationAttempt[] = [];
  const repairs: RepairAttemptSummary[] = [];
  const skillLoads: SkillLoadRecord[] = [];
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
      skillLoads,
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
      if (options.emitSuccessOutcome !== false) {
        tracer.record("workflow_outcome", {
          status: "success",
          reason: "verified_success",
          verificationAttempts: attempt,
          repairAttempts,
        });
      }
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
        skillLoads,
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
        skillLoads,
      };
    }

    repairAttempts = decision.attempt;
    previousSignature = normalized?.signature ?? null;
    const repairBefore = snapshotDirectory(config.targetSrcRoot);

    tracer.record("repair_started", {
      attempt: repairAttempts,
      ...routingTraceFields(resolveModel("repair", config)),
      conversationStateMode,
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
      conversationStateMode,
    });

    lastRepairChangedFiles = repair.changedFiles.length > 0;
    modelFinalResponse = repair.modelFinalResponse;
    skillLoads.push(...collectedSkillLoads(repair));
    repairs.push({
      attempt: repairAttempts,
      modelCalls: repair.modelCalls,
      toolCalls: repair.toolCalls,
      turns: repair.turns,
      receivedTerminalResponse: repair.receivedTerminalResponse,
      changedFiles: repair.changedFiles,
      durationMs: repair.durationMs,
      tokenUsage: repair.tokenUsage,
      clientInputItemsSent: repair.clientInputItemsSent,
      clientInputBytesSent: repair.clientInputBytesSent,
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
        skillLoads,
      };
    }
  }
}

async function runIndependentReviewLoop(options: {
  config: HarnessConfig;
  task: string;
  spec: Spec;
  tracer: Tracer;
  reusableContext: ReusableContext | undefined;
  runId: string;
  implementation: AgentRunResult;
  beforeSnapshot: FileSnapshot;
  architectureConstraints: ArchitectureConstraint[];
  lastVerification: VerificationResult;
  lastVerificationAttempt: number;
  conversationStateMode: ConversationStateMode;
}): Promise<{
  workflowStatus: WorkflowStatus;
  failureReason?: WorkflowFailureReason;
  modelFinalResponse: string;
  extraVerificationAttempts: number;
  extraRepairAttempts: number;
  extraVerifications: VerificationAttempt[];
  extraRepairs: RepairAttemptSummary[];
  repeatedFailure: boolean;
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult;
  reviewState: ReviewRunState;
  skillLoads: SkillLoadRecord[];
}> {
  const {
    config,
    task,
    spec,
    tracer,
    reusableContext,
    runId,
    beforeSnapshot,
    architectureConstraints,
    conversationStateMode,
  } = options;

  const reviews: ReviewAttemptSummary[] = [];
  const reviewRepairs: ReviewRepairSummary[] = [];
  const extraVerifications: VerificationAttempt[] = [];
  const extraRepairs: RepairAttemptSummary[] = [];
  const skillLoads: SkillLoadRecord[] = [];
  let extraVerificationAttempts = 0;
  let extraRepairAttempts = 0;
  let reviewRepairAttempts = 0;
  let previousBlockingKeys: string[] = [];
  let lastVerification = options.lastVerification;
  let lastVerificationAttempt = options.lastVerificationAttempt;
  let modelFinalResponse = options.implementation.modelFinalResponse;
  let repeatedFailure = false;

  const runReviewRound = async (
    round: number,
  ): Promise<
    | { ok: true; blockingKeys: string[] }
    | { ok: false; reason: "review_parse_failed" }
  > => {
    const current = snapshotDirectory(config.targetSrcRoot);
    const { changedFiles, unifiedDiff } = diffSnapshots(
      beforeSnapshot,
      current,
    );
    const context: ReviewContext = {
      spec,
      unifiedDiff,
      changedFiles,
      architectureConstraints,
      verificationEvidence: {
        passed: lastVerification.passed,
        exitCode: lastVerification.exitCode,
        durationMs: lastVerification.durationMs,
        attempt: lastVerificationAttempt,
      },
    };

    const review = await runIndependentReview({
      config,
      context,
      tracer,
      round,
    });

    if (!review.result) {
      tracer.record("review_completed", {
        round,
        parseOk: false,
        failureReason: review.failureReason ?? "invalid_review",
        modelCalls: review.modelCalls,
        durationMs: review.durationMs,
      });
      return { ok: false, reason: "review_parse_failed" };
    }

    const decisions = review.result.findings.map((finding) => {
      const decided = decideFinding(finding, context);
      tracer.record("review_finding", {
        round,
        findingKey: finding.findingKey,
        category: finding.category,
        severity: finding.severity,
        confidence: finding.confidence,
        description: finding.description,
        evidence: finding.evidence,
        relatedAuthority: finding.relatedAuthority ?? null,
      });
      tracer.record("review_finding_decision", {
        round,
        findingKey: finding.findingKey,
        decision: decided.decision,
        reason: decided.reason,
      });
      return decided;
    });

    const blockingKeys = decisions
      .filter((item) => item.decision === "accepted_blocking")
      .map((item) => item.finding.findingKey);

    reviews.push({
      round,
      status: review.result.status,
      findings: review.result.findings,
      decisions,
      modelCalls: review.modelCalls,
      toolCalls: review.toolCalls,
      durationMs: review.durationMs,
      parseOk: true,
      tokenUsage: review.tokenUsage,
    });

    tracer.record("review_completed", {
      round,
      parseOk: true,
      status: review.result.status,
      findingsCount: review.result.findings.length,
      acceptedBlocking: blockingKeys.length,
      acceptedNonBlocking: decisions.filter(
        (item) => item.decision === "accepted_non_blocking",
      ).length,
      rejected: decisions.filter((item) => item.decision === "rejected").length,
      modelCalls: review.modelCalls,
      durationMs: review.durationMs,
    });

    return { ok: true, blockingKeys };
  };

  const finish = (
    workflowStatus: WorkflowStatus,
    finalReviewerOutcome: ReviewRunState["finalReviewerOutcome"],
    extra?: {
      failureReason?: WorkflowFailureReason;
      repeatedFinding?: boolean;
    },
  ) => {
    const aggregated = aggregateReviewState(reviews);
    const reviewState: ReviewRunState = {
      ...emptyReviewRunState(),
      reviewAttempts: reviews.length,
      reviews,
      reviewRepairAttempts,
      reviewRepairs,
      repeatedFinding: extra?.repeatedFinding ?? false,
      finalReviewerOutcome,
      ...aggregated,
    };
    tracer.record("workflow_outcome", {
      status: workflowStatus,
      reason: extra?.failureReason ?? finalReviewerOutcome,
      reviewAttempts: reviews.length,
      reviewRepairAttempts,
      intendedFindingDetected: reviewState.intendedFindingDetected,
      acceptedBlocking: reviewState.acceptedBlockingFindings.length,
      blockingFalsePositives: reviewState.blockingFalsePositives.length,
      repeatedFinding: reviewState.repeatedFinding,
    });
    return {
      workflowStatus,
      failureReason: extra?.failureReason,
      modelFinalResponse,
      extraVerificationAttempts,
      extraRepairAttempts,
      extraVerifications,
      extraRepairs,
      repeatedFailure,
      finalVerificationPassed: lastVerification.passed,
      finalVerification: lastVerification,
      reviewState,
      skillLoads,
    };
  };

  const first = await runReviewRound(1);
  if (!first.ok) {
    return finish("failure", "parse_failed", {
      failureReason: "review_parse_failed",
    });
  }

  const firstDecision = nextReviewDecision({
    reviewRound: 1,
    acceptedBlockingKeys: first.blockingKeys,
    previousBlockingKeys,
    reviewRepairAttemptsUsed: reviewRepairAttempts,
    maxReviewRepairAttempts: config.maxReviewRepairAttempts,
  });

  if (firstDecision.action === "success") {
    return finish("success", "pass");
  }

  if (firstDecision.action === "stop") {
    return finish("failure", "findings_unresolved", {
      failureReason: "review_unresolved_blocker",
      repeatedFinding: firstDecision.repeatedFinding,
    });
  }

  previousBlockingKeys = first.blockingKeys;
  reviewRepairAttempts = firstDecision.attempt;
  const acceptedBlockers = reviews[0].decisions
    .filter((item) => item.decision === "accepted_blocking")
    .map((item) => item.finding);

  const repairBefore = snapshotDirectory(config.targetSrcRoot);
  tracer.record("review_repair_started", {
    attempt: reviewRepairAttempts,
    ...routingTraceFields(resolveModel("review_repair", config)),
    conversationStateMode,
    maxReviewRepairAttempts: config.maxReviewRepairAttempts,
    findingKeys: acceptedBlockers.map((item) => item.findingKey),
    promptIncludesSpec: true,
    promptIncludesAcceptedFindings: true,
  });

  const repair = await runAgentLoop({
    config,
    task: formatReviewRepairContract(task, spec, acceptedBlockers),
    runId,
    beforeSnapshot: repairBefore,
    spec,
    tracer,
    reusableContext,
    phase: "review_repair",
    conversationStateMode,
  });

  modelFinalResponse = repair.modelFinalResponse;
  skillLoads.push(...collectedSkillLoads(repair));
  reviewRepairs.push({
    attempt: reviewRepairAttempts,
    modelCalls: repair.modelCalls,
    toolCalls: repair.toolCalls,
    turns: repair.turns,
    receivedTerminalResponse: repair.receivedTerminalResponse,
    changedFiles: repair.changedFiles,
    durationMs: repair.durationMs,
    tokenUsage: repair.tokenUsage,
    clientInputItemsSent: repair.clientInputItemsSent,
    clientInputBytesSent: repair.clientInputBytesSent,
  });
  tracer.record("review_repair_completed", {
    attempt: reviewRepairAttempts,
    episodeStatus: repair.status,
    changedFiles: repair.changedFiles,
    modelCalls: repair.modelCalls,
    toolCalls: repair.toolCalls,
    durationMs: repair.durationMs,
    failureReason: repair.failureReason ?? null,
  });

  if (!shouldVerifyAfterReviewRepair(repair.failureReason)) {
    return finish("failure", "findings_unresolved", {
      failureReason: "model_error",
    });
  }

  const postRepair = await runVerifyRepairLoop({
    config,
    task,
    spec,
    tracer,
    reusableContext,
    runId,
    implementation: repair,
    conversationStateMode,
    emitSuccessOutcome: false,
  });

  extraVerifications.push(
    ...postRepair.verifications.map((item, index) => ({
      ...item,
      attempt: lastVerificationAttempt + index + 1,
    })),
  );
  extraRepairs.push(...postRepair.repairs);
  extraVerificationAttempts = postRepair.verificationAttempts;
  extraRepairAttempts = postRepair.repairAttempts;
  skillLoads.push(...postRepair.skillLoads);
  repeatedFailure = postRepair.repeatedFailure;
  lastVerification = postRepair.finalVerification ?? lastVerification;
  lastVerificationAttempt =
    lastVerificationAttempt + postRepair.verificationAttempts;
  modelFinalResponse = postRepair.modelFinalResponse;

  if (
    postRepair.workflowStatus !== "success" ||
    !postRepair.finalVerificationPassed
  ) {
    return finish("failure", "findings_unresolved", {
      failureReason: postRepair.failureReason ?? "final_verification_failed",
    });
  }

  const second = await runReviewRound(2);
  if (!second.ok) {
    return finish("failure", "parse_failed", {
      failureReason: "review_parse_failed",
    });
  }

  const secondDecision = nextReviewDecision({
    reviewRound: 2,
    acceptedBlockingKeys: second.blockingKeys,
    previousBlockingKeys,
    reviewRepairAttemptsUsed: reviewRepairAttempts,
    maxReviewRepairAttempts: config.maxReviewRepairAttempts,
  });

  if (secondDecision.action === "success") {
    return finish("success", "pass");
  }

  return finish("failure", "findings_unresolved", {
    failureReason: "review_unresolved_blocker",
    repeatedFinding:
      secondDecision.action === "stop" && secondDecision.repeatedFinding,
  });
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
  conversationStateMode: ConversationStateMode;
  contextPreparation: ContextPreparation | null;
  receivedTerminalResponse: boolean;
  verificationAttempts: number;
  repairAttempts: number;
  repeatedFailure: boolean;
  verifications: VerificationAttempt[];
  repairs: RepairAttemptSummary[];
  review?: ReviewRunState;
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult | null;
  modelFinalResponse: string;
  changedFiles: string[];
  unifiedDiff: string;
  tracePath: string;
  durationMs: number;
  skillLoads?: SkillLoadRecord[];
  workspace?: Workspace;
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

  const review = fields.review ?? emptyReviewRunState();
  const repairTokenUsage = fields.repairs.map((item) => item.tokenUsage);
  const reviewTokenUsage = review.reviews.map((item) => item.tokenUsage);
  const reviewRepairTokenUsage = review.reviewRepairs.map(
    (item) => item.tokenUsage,
  );

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
      ...reviewTokenUsage,
      ...reviewRepairTokenUsage,
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
  const reviewModelCalls = review.reviews.reduce(
    (sum, item) => sum + item.modelCalls,
    0,
  );
  const reviewToolCalls = review.reviews.reduce(
    (sum, item) => sum + item.toolCalls,
    0,
  );
  const reviewRepairTurns = review.reviewRepairs.reduce(
    (sum, item) => sum + item.turns,
    0,
  );
  const reviewRepairModelCalls = review.reviewRepairs.reduce(
    (sum, item) => sum + item.modelCalls,
    0,
  );
  const reviewRepairToolCalls = review.reviewRepairs.reduce(
    (sum, item) => sum + item.toolCalls,
    0,
  );

  const clientInputItemsSent =
    (implementation?.clientInputItemsSent ?? 0) +
    fields.repairs.reduce(
      (sum, item) => sum + (item.clientInputItemsSent ?? 0),
      0,
    ) +
    review.reviewRepairs.reduce(
      (sum, item) => sum + (item.clientInputItemsSent ?? 0),
      0,
    );
  const clientInputBytesSent =
    (implementation?.clientInputBytesSent ?? 0) +
    fields.repairs.reduce(
      (sum, item) => sum + (item.clientInputBytesSent ?? 0),
      0,
    ) +
    review.reviewRepairs.reduce(
      (sum, item) => sum + (item.clientInputBytesSent ?? 0),
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
    turns:
      fields.specPhase.turns +
      (implementation?.turns ?? 0) +
      repairTurns +
      reviewRepairTurns,
    modelCalls:
      fields.specPhase.modelCalls +
      (implementation?.modelCalls ?? 0) +
      repairModelCalls +
      reviewModelCalls +
      reviewRepairModelCalls,
    toolCalls:
      fields.specPhase.toolCalls +
      (implementation?.toolCalls ?? 0) +
      repairToolCalls +
      reviewToolCalls +
      reviewRepairToolCalls,
    receivedTerminalResponse: fields.receivedTerminalResponse,
    verificationAttempts: fields.verificationAttempts,
    repairAttempts: fields.repairAttempts,
    repeatedFailure: fields.repeatedFailure,
    verifications: fields.verifications,
    repairs: fields.repairs,
    reviewAttempts: review.reviewAttempts,
    reviews: review.reviews,
    reviewRepairAttempts: review.reviewRepairAttempts,
    reviewRepairs: review.reviewRepairs,
    repeatedFinding: review.repeatedFinding,
    intendedFindingDetected: review.intendedFindingDetected,
    acceptedBlockingFindings: review.acceptedBlockingFindings,
    acceptedNonBlockingFindings: review.acceptedNonBlockingFindings,
    rejectedFindings: review.rejectedFindings,
    blockingFalsePositives: review.blockingFalsePositives,
    finalReviewerOutcome: review.finalReviewerOutcome,
    finalVerificationPassed: fields.finalVerificationPassed,
    finalVerification: fields.finalVerification,
    modelFinalResponse: fields.modelFinalResponse,
    changedFiles: fields.changedFiles,
    unifiedDiff: fields.unifiedDiff,
    tracePath: fields.tracePath,
    specPath: "",
    durationMs: fields.durationMs,
    contextMode: fields.contextMode,
    conversationStateMode: fields.conversationStateMode,
    clientInputItemsSent,
    clientInputBytesSent,
    contextMetrics,
    skillLoads: fields.skillLoads ?? [],
    ...(fields.workspace ? { workspace: fields.workspace } : {}),
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
    version: "v3",
    workflowStatus: result.workflowStatus,
    ...(result.workspace
      ? {
          workspace: {
            id: result.workspace.id,
            root: result.workspace.root,
            baseRevision: result.workspace.baseRevision,
            ref: result.workspace.ref,
          },
        }
      : {}),
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
    reviewAttempts: result.reviewAttempts,
    reviews: result.reviews.map((item) => ({
      round: item.round,
      status: item.status,
      parseOk: item.parseOk,
      findingsCount: item.findings.length,
      findings: item.findings,
      decisions: item.decisions.map((decision) => ({
        findingKey: decision.finding.findingKey,
        category: decision.finding.category,
        severity: decision.finding.severity,
        confidence: decision.finding.confidence,
        description: decision.finding.description,
        evidence: decision.finding.evidence,
        relatedAuthority: decision.finding.relatedAuthority ?? null,
        decision: decision.decision,
        reason: decision.reason,
      })),
    })),
    reviewRepairAttempts: result.reviewRepairAttempts,
    reviewRepairs: result.reviewRepairs,
    repeatedFinding: result.repeatedFinding,
    intendedFindingDetected: result.intendedFindingDetected,
    acceptedBlockingFindings: result.acceptedBlockingFindings.map((item) => ({
      findingKey: item.finding.findingKey,
      category: item.finding.category,
      description: item.finding.description,
      evidence: item.finding.evidence,
      relatedAuthority: item.finding.relatedAuthority ?? null,
      reason: item.reason,
    })),
    acceptedNonBlockingFindings: result.acceptedNonBlockingFindings.map(
      (item) => ({
        findingKey: item.finding.findingKey,
        category: item.finding.category,
        description: item.finding.description,
        reason: item.reason,
      }),
    ),
    rejectedFindings: result.rejectedFindings.map((item) => ({
      findingKey: item.finding.findingKey,
      category: item.finding.category,
      description: item.finding.description,
      reason: item.reason,
    })),
    blockingFalsePositives: result.blockingFalsePositives.map((item) => ({
      findingKey: item.finding.findingKey,
    })),
    finalReviewerOutcome: result.finalReviewerOutcome,
    finalVerificationPassed: result.finalVerificationPassed,
    changedFiles: result.changedFiles,
    durationMs: result.durationMs,
    contextMode: result.contextMode,
    conversationStateMode: result.conversationStateMode,
    clientInputItemsSent: result.clientInputItemsSent,
    clientInputBytesSent: result.clientInputBytesSent,
    contextMetrics: result.contextMetrics,
    skillLoads: result.skillLoads,
  });
  await tracer.close();
}

function collectedSkillLoads(result: AgentRunResult): SkillLoadRecord[] {
  return result.skillLoad ? [result.skillLoad] : [];
}

function formatSkillLoads(loads: SkillLoadRecord[]): string {
  if (loads.length === 0) {
    return "(none)";
  }
  return loads
    .map((item) => `${item.skillId}@${item.phase} ${item.contentHash}`)
    .join("; ");
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
