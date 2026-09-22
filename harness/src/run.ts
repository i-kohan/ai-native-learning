import path from "node:path";
import { type HarnessConfig, REPO_ROOT } from "./config.ts";
import {
  buildRepositoryMap,
  type ContextMode,
  type ContextPreparation,
  type ContextRunMetrics,
  combineTokenUsage,
  computePathOverlap,
  type InspectedPaths,
  type PhaseDiscoveryMetrics,
  type ReusableContext,
  type TokenUsageSummary,
} from "./context.ts";
import {
  diffSnapshots,
  type FileSnapshot,
  reviewDeltaIdentity,
  snapshotDirectory,
} from "./diff.ts";
import { shouldEnableSubagents } from "./evidence.ts";
import { type NormalizedFailure, normalizeFailure } from "./failure.ts";
import {
  type ChildEpisodeResult,
  executeFanOut,
  type FanOutEvidence,
} from "./fan-out.ts";
import {
  childVerificationFiles,
  type FanOutPlan,
  type FanOutSchedule,
  type FanOutUnit,
  formatWorkerFanOutUnitTask,
  type ParseFanOutPlanResult,
} from "./fan-out-plan.ts";
import {
  type AgentRunResult,
  type ConversationStateMode,
  runAgentLoop,
} from "./loop.ts";
import { resolveModel, routingTraceFields } from "./model-routing.ts";
import { formatWorkerTask, type Plan, shouldRunPlanner } from "./plan.ts";
import { buildPlan, type PlannerPhaseResult } from "./planner-phase.ts";
import { formatRepairContract, nextRepairDecision } from "./repair.ts";
import {
  DEFAULT_MAX_REVIEW_RETRY_ATTEMPTS,
  type DurableRetryState,
  executeReviewWithRetry,
  logicalReviewId,
  type RetryDecision,
  reviewOperationId,
} from "./retry.ts";
import {
  type ArchitectureConstraint,
  aggregateReviewState,
  decideFinding,
  emptyReviewRunState,
  type FindingDecisionRecord,
  formatReviewRepairContract,
  nextReviewDecision,
  type ReviewAttemptSummary,
  type ReviewContext,
  type ReviewRepairSummary,
  type ReviewRunState,
  shouldStartReview,
} from "./review.ts";
import {
  loadReviewBaseline,
  persistReviewBaseline,
} from "./review-baseline.ts";
import {
  type ReviewPhaseResult,
  runIndependentReview,
} from "./review-phase.ts";
import {
  type ChangeUnitTemplate,
  cumulativeTestFiles,
  formatReviewabilityReport,
  formatWorkerUnitTask,
  orderedUnits,
  type ParseReviewPlanResult,
  type ReviewPlan,
  type ReviewUnitReport,
  shouldContinueDecomposedUnits,
  writeReviewabilityReport,
} from "./review-plan.ts";
import type { SkillLoadRecord } from "./skills.ts";
import {
  type Ambiguity,
  type Spec,
  type SpecDecision,
  summarizeAmbiguities,
  writeSpecArtifact,
} from "./spec.ts";
import { buildSpec, type SpecPhaseResult } from "./spec-phase.ts";
import { Tracer } from "./trace.ts";
import {
  runFinalVerification,
  runScopedVerification,
  type VerificationResult,
} from "./verify.ts";
import { WorkflowError } from "./workflow-error.ts";
import type { WorkflowLease } from "./workflow-lease.ts";
import { systemNowMs } from "./workflow-lease.ts";
import {
  acquireWorkflowLease,
  createWorkflowOwnerId,
  DEFAULT_WORKFLOW_LEASE_TTL_MS,
  releaseWorkflowLease,
} from "./workflow-lease-store.ts";
import {
  admitImplementationReady,
  admitReviewReady,
  admitReviewRetryState,
  admitTerminal,
  type DurableCheckpoint,
  type ImplementationReadyState,
  nextDurableAction,
  type ReviewReadyState,
  type WorkflowState,
} from "./workflow-state.ts";
import { loadWorkflowState, saveWorkflowStateOwned } from "./workflow-store.ts";
import {
  bindResumedWorkspace,
  captureWorkspaceResumeEvidence,
  cleanupWorkspace,
  type Workspace,
} from "./workspace.ts";

export type WorkflowStatus =
  | "success"
  | "failure"
  | "needs_human_judgment"
  | "paused";

export type DurableRunOptions = {
  workflowId: string;
  storeDir: string;
  hostRepoRoot?: string;
  stopAfter?: DurableCheckpoint;
  /** Probe/test only. Inject a retryable REVIEW provider failure on this attempt. */
  injectReviewTransientFailureOnAttempt?: number;
  /** Probe/test only. Persist retry admission and exit before the next attempt. */
  stopAfterRetryAdmission?: boolean;
  /** Test/probe clock. Production uses system time. */
  nowMs?: () => number;
  /** Test/probe TTL. Production uses DEFAULT_WORKFLOW_LEASE_TTL_MS. */
  leaseTtlMs?: number;
  /** Harness-owned after acquire. Callers must not set this. */
  lease?: WorkflowLease;
};

export type WorkflowFailureReason =
  | AgentRunResult["failureReason"]
  | "spec_phase_failed"
  | "plan_phase_failed"
  | "review_plan_invalid"
  | "fan_out_plan_invalid"
  | "child_verification_failed"
  | "fan_in_conflict"
  | "fan_in_lost_changes"
  | "final_verification_failed"
  | "review_parse_failed"
  | "review_unresolved_blocker"
  | "review_retry_exhausted"
  | "retry_needs_reconciliation"
  | "unit_verification_failed";

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
  planningEnabled: boolean;
  plan: Plan | null;
  plannerTurns: number;
  plannerModelCalls: number;
  plannerToolCalls: number;
  plannerDurationMs: number;
  subagentsEnabled: boolean;
  reviewPlan: ReviewPlan | null;
  reviewUnits: ReviewUnitReport[];
  reviewabilityReportPath: string | null;
  reviewUnitGateFailed: boolean;
  stoppedReviewUnitId: string | null;
  fanOut: FanOutEvidence | null;
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
  workflowId?: string;
  durableCheckpoint?: DurableCheckpoint;
  implementationSkipped?: boolean;
  preReviewVerifySkipped?: boolean;
  reviewBaselineRestored?: boolean;
  durableRetry?: DurableRetryState;
  lastRetryDecision?: RetryDecision;
};

export async function runV1Harness(options: {
  config: HarnessConfig;
  task: string;
  runId: string;
  beforeSnapshot?: FileSnapshot;
  contextMode?: ContextMode;
  conversationStateMode?: ConversationStateMode;
  architectureConstraints?: ArchitectureConstraint[];
  /** Experiment-only. Default architecture does not run an explicit Planner. */
  planningEnabled?: boolean;
  /** Experiment-only. Default architecture does not expose Worker subagents. */
  subagentsEnabled?: boolean;
  /**
   * Experiment-only advisory ReviewPlan. Default architecture remains one Worker.
   * The binder is harness-owned and must not be an LLM Review Planner.
   */
  bindReviewPlan?: (spec: Spec) => ParseReviewPlanResult;
  reviewUnitTemplates?: ChangeUnitTemplate[];
  /**
   * Experiment-only bounded fan-out. Default architecture remains one Worker.
   * The binder is harness-owned and must not be an LLM fan-out planner.
   */
  bindFanOutPlan?: (spec: Spec) => ParseFanOutPlanResult;
  fanOutSchedule?: FanOutSchedule;
  fanOutChildWorkspaces?: Record<string, Workspace>;
  prepareFanOutWorkspace?: (config: HarnessConfig) => void;
  /**
   * Experiment-only. Skip a live Spec model call and continue from this
   * already-admitted executable Spec. Default runV1Harness still builds Spec.
   */
  admittedSpec?: Extract<SpecDecision, { status: "executable" }>;
  frozenSpecPhase?: SpecPhaseResult;
  /** Benchmark-only hook. Production runs must not pass this. */
  afterImplementationEpisode?: () => void;
  workspace?: Workspace;
  /** Opt-in Module 16 durability. Absent = current in-memory workflow. */
  durable?: DurableRunOptions;
}): Promise<HarnessRunResult> {
  const durable: DurableRunOptions | undefined = options.durable
    ? { ...options.durable, lease: undefined }
    : undefined;
  let lease: WorkflowLease | undefined;
  if (durable) {
    assertDurableModeSupported(options);
    const acquired = acquireWorkflowLease({
      storeDir: durable.storeDir,
      workflowId: durable.workflowId,
      ownerId: createWorkflowOwnerId(),
      ttlMs: durable.leaseTtlMs ?? DEFAULT_WORKFLOW_LEASE_TTL_MS,
      now: durableNowMs(durable),
    });
    if (!acquired.ok) {
      throw new WorkflowError(
        "lease_held",
        `Workflow ${durable.workflowId} is already owned by another invocation.`,
      );
    }
    lease = acquired.lease;
    durable.lease = lease;
  }

  try {
    return await executeV1Harness({ ...options, durable });
  } finally {
    if (durable && lease) {
      releaseWorkflowLease({
        storeDir: durable.storeDir,
        lease,
      });
    }
  }
}

async function executeV1Harness(options: {
  config: HarnessConfig;
  task: string;
  runId: string;
  beforeSnapshot?: FileSnapshot;
  contextMode?: ContextMode;
  conversationStateMode?: ConversationStateMode;
  planningEnabled?: boolean;
  subagentsEnabled?: boolean;
  bindReviewPlan?: (spec: Spec) => ParseReviewPlanResult;
  reviewUnitTemplates?: ChangeUnitTemplate[];
  bindFanOutPlan?: (spec: Spec) => ParseFanOutPlanResult;
  fanOutSchedule?: FanOutSchedule;
  fanOutChildWorkspaces?: Record<string, Workspace>;
  prepareFanOutWorkspace?: (config: HarnessConfig) => void;
  admittedSpec?: Extract<SpecDecision, { status: "executable" }>;
  frozenSpecPhase?: SpecPhaseResult;
  afterImplementationEpisode?: () => void;
  workspace?: Workspace;
  architectureConstraints?: ArchitectureConstraint[];
  durable?: DurableRunOptions;
}): Promise<HarnessRunResult> {
  const durable = options.durable;
  if (durable) {
    assertDurableModeSupported(options);
  }

  let workflow = durable
    ? loadWorkflowState(durable.storeDir, durable.workflowId)
    : null;
  if (workflow && nextDurableAction(workflow) === "reject_terminal") {
    throw new WorkflowError(
      "terminal_resume",
      `Workflow ${workflow.workflowId} is already terminal.`,
    );
  }

  let config = options.config;
  let workspace = options.workspace;
  if (workflow) {
    const bound = bindResumedWorkspace({
      hostRepoRoot: durable?.hostRepoRoot ?? REPO_ROOT,
      config,
      expected: workflow.workspace,
    });
    if (
      options.workspace &&
      (pathMismatch(options.workspace.root, bound.workspace.root) ||
        options.workspace.id !== bound.workspace.id)
    ) {
      throw new WorkflowError(
        "workspace_mismatch",
        "Caller workspace does not match persisted workflow workspace.",
      );
    }
    config = bound.config;
    workspace = bound.workspace;
  }

  const task = workflow?.task ?? options.task;
  const runId = options.runId;
  const planningEnabled = shouldRunPlanner(options.planningEnabled === true);
  const subagentsEnabled = shouldEnableSubagents(
    options.subagentsEnabled === true,
  );
  const conversationStateMode: ConversationStateMode =
    options.conversationStateMode ?? "manual";
  const startedAt = Date.now();
  const tracer = new Tracer(config.tracesDir, runId);
  if (durable?.lease) {
    tracer.record("workflow_lease_acquired", {
      workflowId: durable.lease.workflowId,
      ownerId: durable.lease.ownerId,
      fencingToken: durable.lease.fencingToken,
      pid: process.pid,
      source: "harness",
    });
  }

  if (workflow?.phase === "review_ready") {
    return continueAfterVerifiedImplementation({
      config,
      task,
      runId,
      tracer,
      startedAt,
      conversationStateMode,
      architectureConstraints: options.architectureConstraints,
      workspace,
      durable,
      workflow,
    });
  }

  if (workflow?.phase === "implementation_ready") {
    return continueAfterAdmittedSpec({
      config,
      task,
      runId,
      tracer,
      startedAt,
      decision: { status: "executable", spec: workflow.spec },
      specPhase: resumedSpecPhase(workflow),
      contextMode: workflow.contextMode,
      conversationStateMode,
      planningEnabled,
      subagentsEnabled,
      architectureConstraints: options.architectureConstraints,
      bindReviewPlan: options.bindReviewPlan,
      reviewUnitTemplates: options.reviewUnitTemplates,
      bindFanOutPlan: options.bindFanOutPlan,
      fanOutSchedule: options.fanOutSchedule,
      fanOutChildWorkspaces: options.fanOutChildWorkspaces,
      prepareFanOutWorkspace: options.prepareFanOutWorkspace,
      afterImplementationEpisode: options.afterImplementationEpisode,
      workspace,
      durable,
      workflow,
      specSkipped: true,
    });
  }

  const contextMode = options.contextMode ?? "baseline";
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
    planningEnabled,
    subagentsEnabled,
    repoRoot: config.repoRoot,
    targetAppRoot: config.targetAppRoot,
    targetSrcRoot: config.targetSrcRoot,
    pid: process.pid,
    ...(workspace
      ? {
          workspace: {
            id: workspace.id,
            root: workspace.root,
            baseRevision: workspace.baseRevision,
            ref: workspace.ref,
          },
        }
      : {}),
    ...(durable
      ? {
          workflowId: durable.workflowId,
          durablePhase: workflow?.phase ?? null,
          invocationId: runId,
        }
      : {}),
  });

  if (options.admittedSpec) {
    if (options.admittedSpec.status !== "executable") {
      throw new Error(
        "admittedSpec is experiment-only and must be executable.",
      );
    }
    tracer.record("spec_phase_skipped", {
      reason: "experiment_frozen_spec",
      implementationStarted: false,
    });
    const specPhase = options.frozenSpecPhase
      ? {
          ...options.frozenSpecPhase,
          decision: options.admittedSpec,
          turns: 0,
          modelCalls: 0,
          toolCalls: 0,
          durationMs: 0,
          tokenUsage: null,
        }
      : emptyFrozenSpecPhase(options.admittedSpec);
    return continueAfterAdmittedSpec({
      config,
      task,
      runId,
      tracer,
      startedAt,
      beforeSnapshot,
      decision: options.admittedSpec,
      specPhase,
      contextMode,
      conversationStateMode,
      contextPreparation,
      repositoryMap,
      planningEnabled,
      subagentsEnabled,
      architectureConstraints: options.architectureConstraints,
      bindReviewPlan: options.bindReviewPlan,
      reviewUnitTemplates: options.reviewUnitTemplates,
      bindFanOutPlan: options.bindFanOutPlan,
      fanOutSchedule: options.fanOutSchedule,
      fanOutChildWorkspaces: options.fanOutChildWorkspaces,
      prepareFanOutWorkspace: options.prepareFanOutWorkspace,
      afterImplementationEpisode: options.afterImplementationEpisode,
      workspace,
      durable,
      workflow,
      specSkipped: false,
    });
  }

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
      plannerPhase: emptyPlannerPhase(),
      planningEnabled,
      subagentsEnabled,
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
      workspace,
      workflowId: workflow?.workflowId,
    });
    tracer.record("harness_gate", {
      action: "abort",
      reason: specPhase.failureReason ?? "spec_phase_failed",
    });
    persistDurableTerminal(durable, workflow, {
      workflowStatus: "failure",
      failureReason: "spec_phase_failed",
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
      plannerPhase: emptyPlannerPhase(),
      planningEnabled,
      subagentsEnabled,
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
      workspace,
      workflowId: workflow?.workflowId,
    });
    persistDurableTerminal(durable, workflow, {
      workflowStatus: "needs_human_judgment",
    });
    await finishRun(tracer, result);
    return result;
  }

  if (workflow) {
    workflow = persistImplementationReady({
      durable,
      workflow,
      decision,
      specInspectedPaths: specPhase.inspectedPaths,
      contextMode,
      tracer,
    });
    if (durable?.stopAfter === "implementation_ready") {
      return pausedAfterSpec({
        task,
        specPhase,
        decision,
        planningEnabled,
        subagentsEnabled,
        contextMode,
        conversationStateMode,
        contextPreparation,
        tracer,
        startedAt,
        beforeSnapshot,
        workspace,
        workflowId: workflow.workflowId,
      });
    }
  }

  return continueAfterAdmittedSpec({
    config,
    task,
    runId,
    tracer,
    startedAt,
    beforeSnapshot,
    decision,
    specPhase,
    contextMode,
    conversationStateMode,
    contextPreparation,
    repositoryMap,
    planningEnabled,
    subagentsEnabled,
    architectureConstraints: options.architectureConstraints,
    bindReviewPlan: options.bindReviewPlan,
    reviewUnitTemplates: options.reviewUnitTemplates,
    bindFanOutPlan: options.bindFanOutPlan,
    fanOutSchedule: options.fanOutSchedule,
    fanOutChildWorkspaces: options.fanOutChildWorkspaces,
    prepareFanOutWorkspace: options.prepareFanOutWorkspace,
    afterImplementationEpisode: options.afterImplementationEpisode,
    workspace,
    durable,
    workflow,
    specSkipped: false,
  });
}

async function continueAfterAdmittedSpec(options: {
  config: HarnessConfig;
  task: string;
  runId: string;
  tracer: Tracer;
  startedAt: number;
  beforeSnapshot?: FileSnapshot;
  decision: Extract<SpecDecision, { status: "executable" }>;
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
  contextPreparation?: ContextPreparation | null;
  repositoryMap?: ReusableContext["repositoryMap"];
  planningEnabled: boolean;
  subagentsEnabled: boolean;
  architectureConstraints?: ArchitectureConstraint[];
  bindReviewPlan?: (spec: Spec) => ParseReviewPlanResult;
  reviewUnitTemplates?: ChangeUnitTemplate[];
  bindFanOutPlan?: (spec: Spec) => ParseFanOutPlanResult;
  fanOutSchedule?: FanOutSchedule;
  fanOutChildWorkspaces?: Record<string, Workspace>;
  prepareFanOutWorkspace?: (config: HarnessConfig) => void;
  afterImplementationEpisode?: () => void;
  workspace?: Workspace;
  durable?: DurableRunOptions;
  workflow: WorkflowState | null;
  specSkipped: boolean;
}): Promise<HarnessRunResult> {
  const {
    config,
    task,
    runId,
    tracer,
    startedAt,
    decision,
    specPhase,
    conversationStateMode,
    planningEnabled,
    subagentsEnabled,
    durable,
  } = options;
  let { repositoryMap } = options;
  let contextPreparation: ContextPreparation | null =
    options.contextPreparation ?? null;
  let workflow = options.workflow;
  const contextMode = options.contextMode;
  const workspace = options.workspace;
  const beforeSnapshot =
    options.beforeSnapshot ?? snapshotDirectory(config.targetSrcRoot);
  const reviewBaselineRef =
    durable && workflow
      ? persistReviewBaseline(
          durable.storeDir,
          workflow.workflowId,
          beforeSnapshot,
        )
      : null;

  if (options.specSkipped) {
    tracer.record("spec_phase_skipped", {
      reason: "durable_resume_implementation_ready",
      workflowId: options.workflow?.workflowId ?? null,
      pid: process.pid,
      invocationId: runId,
    });
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
      planningEnabled,
      subagentsEnabled,
      repoRoot: config.repoRoot,
      targetAppRoot: config.targetAppRoot,
      targetSrcRoot: config.targetSrcRoot,
      pid: process.pid,
      specSkipped: true,
      workflowId: durable?.workflowId ?? null,
      durablePhase: "implementation_ready",
      invocationId: runId,
      ...(workspace
        ? {
            workspace: {
              id: workspace.id,
              root: workspace.root,
              baseRevision: workspace.baseRevision,
              ref: workspace.ref,
            },
          }
        : {}),
    });
    if (contextMode === "variant") {
      contextPreparation = buildRepositoryMap(config);
      repositoryMap = contextPreparation.map;
      tracer.record("context_prepared", {
        contextMode,
        durationMs: contextPreparation.durationMs,
        pathsScanned: contextPreparation.pathsScanned,
        mapEntryCount: contextPreparation.map.entries.length,
        recomputedOnResume: true,
      });
    }
  }

  const reusableContext: ReusableContext | undefined =
    contextMode === "variant" && repositoryMap
      ? {
          repositoryMap,
          specInspectedPaths: specPhase.inspectedPaths,
        }
      : undefined;

  let plannerPhase: PlannerPhaseResult = emptyPlannerPhase();
  if (planningEnabled) {
    plannerPhase = await buildPlan({
      config,
      task,
      spec: decision.spec,
      tracer,
      repositoryMap,
      specInspectedPaths: specPhase.inspectedPaths,
    });

    if (!plannerPhase.plan) {
      const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
      const { changedFiles, unifiedDiff } = diffSnapshots(
        beforeSnapshot,
        afterSnapshot,
      );
      const result = baseResult({
        task,
        workflowStatus: "failure",
        failureReason: "plan_phase_failed",
        specDecision: decision,
        unresolvedQuestions: [],
        implementationStarted: false,
        implementation: null,
        specPhase,
        plannerPhase,
        planningEnabled,
        subagentsEnabled,
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
        modelFinalResponse: plannerPhase.modelFinalResponse,
        changedFiles,
        unifiedDiff,
        tracePath: tracer.tracePath,
        durationMs: Date.now() - startedAt,
        skillLoads: [],
        workspace,
        workflowId: workflow?.workflowId,
      });
      tracer.record("harness_gate", {
        action: "abort",
        reason: plannerPhase.failureReason ?? "plan_phase_failed",
        implementationStarted: false,
      });
      persistDurableTerminal(durable, workflow, {
        workflowStatus: "failure",
        failureReason: "plan_phase_failed",
      });
      await finishRun(tracer, result);
      return result;
    }
  }

  let reviewPlan: ReviewPlan | null = null;
  const reviewUnitTemplates = options.reviewUnitTemplates ?? [];
  if (options.bindReviewPlan) {
    const bound = options.bindReviewPlan(decision.spec);
    if (!bound.ok) {
      const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
      const { changedFiles, unifiedDiff } = diffSnapshots(
        beforeSnapshot,
        afterSnapshot,
      );
      const result = baseResult({
        task,
        workflowStatus: "failure",
        failureReason: "review_plan_invalid",
        specDecision: decision,
        unresolvedQuestions: [],
        implementationStarted: false,
        implementation: null,
        specPhase,
        plannerPhase,
        planningEnabled,
        subagentsEnabled,
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
        modelFinalResponse: bound.error,
        changedFiles,
        unifiedDiff,
        tracePath: tracer.tracePath,
        durationMs: Date.now() - startedAt,
        skillLoads: [],
        workspace,
        workflowId: workflow?.workflowId,
      });
      tracer.record("harness_gate", {
        action: "abort",
        reason: "review_plan_invalid",
        implementationStarted: false,
        reviewPlanError: bound.error,
      });
      persistDurableTerminal(durable, workflow, {
        workflowStatus: "failure",
        failureReason: "review_plan_invalid",
      });
      await finishRun(tracer, result);
      return result;
    }
    reviewPlan = bound.value;
  }

  let fanOutPlan: FanOutPlan | null = null;
  if (options.bindFanOutPlan && options.bindReviewPlan) {
    return abortInvalidFanOutPlan({
      task,
      decision,
      specPhase,
      plannerPhase,
      planningEnabled,
      subagentsEnabled,
      contextMode,
      conversationStateMode,
      contextPreparation,
      beforeSnapshot,
      config,
      tracer,
      startedAt,
      workspace,
      workflowId: workflow?.workflowId,
      durable,
      workflow,
      error: "FanOutPlan and ReviewPlan cannot be combined.",
    });
  }
  if (options.bindFanOutPlan) {
    const bound = options.bindFanOutPlan(decision.spec);
    if (!bound.ok) {
      return abortInvalidFanOutPlan({
        task,
        decision,
        specPhase,
        plannerPhase,
        planningEnabled,
        subagentsEnabled,
        contextMode,
        conversationStateMode,
        contextPreparation,
        beforeSnapshot,
        config,
        tracer,
        startedAt,
        workspace,
        workflowId: workflow?.workflowId,
        durable,
        workflow,
        error: bound.error,
      });
    }
    fanOutPlan = bound.value;
  }

  tracer.record("harness_gate", {
    action: "execute",
    implementationStarted: true,
    planningEnabled,
    subagentsEnabled,
    planAccepted: Boolean(plannerPhase.plan),
    reviewPlanDecision: reviewPlan?.decision ?? null,
    reviewUnitCount: reviewPlan?.units.length ?? 0,
    fanOutUnits: fanOutPlan?.units.map((unit) => unit.id) ?? [],
    fanOutSchedule: options.fanOutSchedule ?? null,
  });

  let implementation: AgentRunResult;
  let reviewUnits: ReviewUnitReport[] = [];
  let reviewUnitGateFailed = false;
  let stoppedReviewUnitId: string | null = null;
  let fanOutEvidence: FanOutEvidence | null = null;
  const admittedFanOut = fanOutPlan;
  if (admittedFanOut) {
    if (!workspace) {
      throw new Error(
        "Fan-out requires an isolated workspace from an exact base revision.",
      );
    }
    const executed = await executeFanOut({
      plan: admittedFanOut,
      schedule: options.fanOutSchedule ?? "sequential",
      hostRepoRoot: durable?.hostRepoRoot ?? REPO_ROOT,
      runId,
      parentConfig: config,
      integration: workspace,
      children: options.fanOutChildWorkspaces,
      prepareWorkspace: options.prepareFanOutWorkspace,
      executeChild: (args) =>
        runFanOutChildEpisode({
          ...args,
          originalTask: task,
          spec: decision.spec,
          plan: admittedFanOut,
          tracer,
          reusableContext,
          runId,
          conversationStateMode,
          subagentsEnabled,
        }),
    });
    for (const owned of executed.workspacesCreatedByHarness) {
      cleanupWorkspace({
        hostRepoRoot: durable?.hostRepoRoot ?? REPO_ROOT,
        workspace: owned,
      });
    }
    fanOutEvidence = executed.evidence;
    if (!executed.implementation) {
      throw new Error("Fan-out produced no implementation episode.");
    }
    implementation = executed.implementation;
    const integrated = snapshotDirectory(config.targetSrcRoot);
    const integratedDiff = diffSnapshots(beforeSnapshot, integrated);
    implementation.changedFiles = integratedDiff.changedFiles;
    implementation.unifiedDiff = integratedDiff.unifiedDiff;
    tracer.record("fan_out_completed", {
      schedule: executed.evidence.schedule,
      ok: executed.ok,
      failureReason: executed.evidence.failureReason,
      childIntervalMs: executed.evidence.childIntervalMs,
      writeSetOverlap: executed.evidence.writeSetOverlap,
      fanIn: {
        ok: executed.evidence.fanIn.ok,
        appliedUnitIds: executed.evidence.fanIn.appliedUnitIds,
        conflict: executed.evidence.fanIn.conflict,
        lostChanges: executed.evidence.fanIn.lostChanges,
      },
      provenance: executed.evidence.provenance,
      children: executed.evidence.children.map((child) => ({
        unitId: child.unitId,
        baseRevision: child.baseRevision,
        changedFiles: child.changedFiles,
        verificationPassed: child.verificationPassed,
        repairAttempts: child.repairAttempts,
        durationMs: child.durationMs,
        modelCalls: child.modelCalls,
        toolCalls: child.toolCalls,
      })),
    });
  } else if (reviewPlan?.decision === "decompose") {
    const decomposed = await runDecomposedImplementation({
      config,
      task,
      spec: decision.spec,
      plan: reviewPlan,
      templates: reviewUnitTemplates,
      tracer,
      reusableContext,
      runId,
      conversationStateMode,
      subagentsEnabled,
      sourceBeforeSnapshot: beforeSnapshot,
    });
    implementation = decomposed.implementation;
    reviewUnits = decomposed.units;
    reviewUnitGateFailed = decomposed.unitGateFailed;
    stoppedReviewUnitId = decomposed.stoppedReviewUnitId;
  } else {
    implementation = await runAgentLoop({
      config,
      task: formatWorkerTask(task, decision.spec, plannerPhase.plan),
      runId,
      beforeSnapshot,
      spec: decision.spec,
      tracer,
      reusableContext,
      phase: "implementation",
      conversationStateMode,
      subagentsEnabled,
    });
  }

  tracer.record("implementation_completed", {
    episodeStatus: implementation.status,
    receivedTerminalResponse: implementation.receivedTerminalResponse,
    modelCalls: implementation.modelCalls,
    toolCalls: implementation.toolCalls,
    changedFiles: implementation.changedFiles,
    durationMs: implementation.durationMs,
    researchDelegations: implementation.researchDelegations,
  });

  if (options.afterImplementationEpisode) {
    options.afterImplementationEpisode();
  }

  let workflowStatus: WorkflowStatus = "failure";
  let failureReason: WorkflowFailureReason | undefined;
  let modelFinalResponse = implementation.modelFinalResponse;
  let verificationAttempts = 0;
  let repairAttempts = 0;
  let repeatedFailure = false;
  let verifications: VerificationAttempt[] = [];
  let repairs: RepairAttemptSummary[] = [];
  let finalVerificationPassed = false;
  let finalVerification: VerificationResult | null = null;
  let reviewState = emptyReviewRunState();
  let lastRetryDecision: RetryDecision | undefined;
  const skillLoads: SkillLoadRecord[] = collectedSkillLoads(implementation);

  const fanOutBlocked = fanOutEvidence !== null && fanOutEvidence.ok === false;
  if (fanOutEvidence && fanOutEvidence.ok === false) {
    failureReason = fanOutFailureReason(fanOutEvidence);
    modelFinalResponse = fanOutFailureMessage(fanOutEvidence);
    tracer.record("workflow_outcome", {
      status: "failure",
      reason: failureReason,
      implementationStarted: true,
      fanOutFailure: fanOutEvidence.failureReason,
    });
  }

  const verified = fanOutBlocked
    ? null
    : await runVerifyRepairLoop({
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

  if (verified) {
    workflowStatus = verified.workflowStatus;
    failureReason = verified.failureReason;
    modelFinalResponse = verified.modelFinalResponse;
    verificationAttempts = verified.verificationAttempts;
    repairAttempts = verified.repairAttempts;
    repeatedFailure = verified.repeatedFailure;
    verifications = verified.verifications;
    repairs = verified.repairs;
    finalVerificationPassed = verified.finalVerificationPassed;
    finalVerification = verified.finalVerification;
    skillLoads.push(...verified.skillLoads);
  }

  const canReview =
    verified !== null &&
    shouldStartReview(verified.finalVerificationPassed) &&
    verified.workflowStatus === "success";
  const lastPassedVerification = canReview ? verified.finalVerification : null;

  if (
    verified &&
    canReview &&
    lastPassedVerification &&
    durable &&
    workflow &&
    reviewBaselineRef
  ) {
    if (!workspace) {
      throw new WorkflowError(
        "workspace_missing",
        "Durable review_ready requires the bound workflow workspace.",
      );
    }
    loadReviewBaseline(durable.storeDir, reviewBaselineRef);
    workflow = persistReviewReadyCheckpoint({
      durable,
      workflow,
      workspace,
      reviewBaseline: reviewBaselineRef,
      verification: {
        passed: true,
        exitCode: lastPassedVerification.exitCode,
        durationMs: lastPassedVerification.durationMs,
        attempt: verified.verificationAttempts,
      },
      tracer,
    });
    if (durable.stopAfter === "review_ready") {
      return pausedAfterReviewReady({
        task,
        specPhase,
        decision,
        planningEnabled,
        subagentsEnabled,
        contextMode,
        conversationStateMode,
        contextPreparation,
        tracer,
        startedAt,
        beforeSnapshot,
        implementation,
        verifications,
        repairs,
        verificationAttempts,
        repairAttempts,
        repeatedFailure,
        finalVerification: lastPassedVerification,
        workspace,
        workflowId: workflow.workflowId,
      });
    }
  }

  if (verified && canReview && lastPassedVerification) {
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
      lastVerification: lastPassedVerification,
      lastVerificationAttempt: verified.verificationAttempts,
      conversationStateMode,
      durable,
      workflow,
    });
    workflow = reviewed.workflow;
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
    if (reviewed.lastRetryDecision) {
      lastRetryDecision = reviewed.lastRetryDecision;
    }
  } else if (verified?.workflowStatus === "success") {
    tracer.record("workflow_outcome", {
      status: "success",
      reason: "verified_success",
      verificationAttempts: verified.verificationAttempts,
      repairAttempts: verified.repairAttempts,
      reviewSkipped: true,
    });
  }

  if (reviewUnitGateFailed) {
    workflowStatus = "failure";
    failureReason = "unit_verification_failed";
    tracer.record("review_unit_gate_failed", {
      stoppedReviewUnitId,
      finalVerificationPassed,
    });
  }

  const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
  const { changedFiles, unifiedDiff } = diffSnapshots(
    beforeSnapshot,
    afterSnapshot,
  );

  let reviewabilityReportPath: string | null = null;
  if (reviewPlan && reviewUnits.length > 0) {
    reviewabilityReportPath = writeReviewabilityReport(
      tracer.tracePath,
      formatReviewabilityReport({
        plan: reviewPlan,
        units: reviewUnits,
        finalChangedFiles: changedFiles,
        finalUnifiedDiff: unifiedDiff,
      }),
    );
  }

  const result = baseResult({
    task,
    workflowStatus,
    failureReason,
    specDecision: decision,
    unresolvedQuestions: [],
    implementationStarted: true,
    implementation,
    specPhase,
    plannerPhase,
    planningEnabled,
    subagentsEnabled,
    reviewPlan,
    reviewUnits,
    reviewabilityReportPath,
    reviewUnitGateFailed,
    stoppedReviewUnitId,
    fanOut: fanOutEvidence,
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
    workspace,
    workflowId: workflow?.workflowId,
    durableRetry:
      workflow?.phase === "review_ready" ? workflow.retry : undefined,
    lastRetryDecision,
  });
  if (result.workflowStatus !== "paused") {
    persistDurableTerminal(durable, workflow, {
      workflowStatus: result.workflowStatus,
      failureReason: result.failureReason,
    });
  }
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
  if (result.workflowId) {
    console.log(`workflow_id: ${result.workflowId}`);
  }
  if (result.durableCheckpoint) {
    console.log(`durable_checkpoint: ${result.durableCheckpoint}`);
  }
  console.log(`spec_decision: ${result.specDecision?.status ?? "(none)"}`);
  console.log(`planning_enabled: ${result.planningEnabled}`);
  console.log(`subagents_enabled: ${result.subagentsEnabled}`);
  console.log(
    `review_plan: ${result.reviewPlan ? result.reviewPlan.decision : "(none)"}`,
  );
  if (result.reviewUnits.length > 0) {
    console.log(
      `review_units: ${result.reviewUnits
        .map(
          (unit) =>
            `${unit.id}:${unit.verificationPassed ? "PASS" : "FAIL"}:${unit.changedFiles.length} files`,
        )
        .join(" | ")}`,
    );
  }
  if (result.reviewabilityReportPath) {
    console.log(`reviewability_report: ${result.reviewabilityReportPath}`);
  }
  if (result.reviewUnitGateFailed) {
    console.log(
      `review_unit_gate: failed at ${result.stoppedReviewUnitId ?? "(unknown)"}`,
    );
  }
  if (result.fanOut) {
    console.log(
      `fan_out: ${result.fanOut.schedule} units=${result.fanOut.children
        .map(
          (child) =>
            `${child.unitId}:${child.verificationPassed ? "PASS" : "FAIL"}`,
        )
        .join(
          " | ",
        )} fan_in=${result.fanOut.fanIn.ok ? "ok" : "failed"} overlap=${result.fanOut.writeSetOverlap.join(",") || "(none)"}`,
    );
  }
  console.log(
    `research_delegations: ${result.implementation?.researchDelegations.length ?? 0}`,
  );
  console.log(
    `plan: ${result.plan ? `${result.plan.steps.length} steps` : "(none)"}`,
  );
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
    `turns/model_calls: ${result.turns}/${result.modelCalls} (spec ${result.specTurns}/${result.specModelCalls}; planner ${result.plannerTurns}/${result.plannerModelCalls})`,
  );
  console.log(
    `tool_calls: ${result.toolCalls} (spec ${result.specToolCalls}; planner ${result.plannerToolCalls})`,
  );
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
      `tokens: in=${usage.totalInputTokens ?? "n/a"} out=${usage.totalOutputTokens ?? "n/a"} (spec in=${usage.specInputTokens ?? "n/a"} out=${usage.specOutputTokens ?? "n/a"}; planner in=${usage.plannerInputTokens ?? "n/a"} out=${usage.plannerOutputTokens ?? "n/a"}; impl in=${usage.implInputTokens ?? "n/a"} out=${usage.implOutputTokens ?? "n/a"}; research in=${usage.researchInputTokens ?? "n/a"} out=${usage.researchOutputTokens ?? "n/a"}; repair in=${usage.repairInputTokens ?? "n/a"} out=${usage.repairOutputTokens ?? "n/a"}; review in=${usage.reviewInputTokens ?? "n/a"} out=${usage.reviewOutputTokens ?? "n/a"}; review_repair in=${usage.reviewRepairInputTokens ?? "n/a"} out=${usage.reviewRepairOutputTokens ?? "n/a"})`,
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

async function abortInvalidFanOutPlan(options: {
  task: string;
  decision: Extract<SpecDecision, { status: "executable" }>;
  specPhase: {
    turns: number;
    modelCalls: number;
    toolCalls: number;
    inspectedPaths: InspectedPaths;
    discovery: PhaseDiscoveryMetrics;
    tokenUsage: TokenUsageSummary | null;
  };
  plannerPhase: PlannerPhaseResult;
  planningEnabled: boolean;
  subagentsEnabled: boolean;
  contextMode: ContextMode;
  conversationStateMode: ConversationStateMode;
  contextPreparation: ContextPreparation | null;
  beforeSnapshot: FileSnapshot;
  config: HarnessConfig;
  tracer: Tracer;
  startedAt: number;
  workspace?: Workspace;
  workflowId?: string;
  durable?: DurableRunOptions;
  workflow: WorkflowState | null;
  error: string;
}): Promise<HarnessRunResult> {
  const afterSnapshot = snapshotDirectory(options.config.targetSrcRoot);
  const { changedFiles, unifiedDiff } = diffSnapshots(
    options.beforeSnapshot,
    afterSnapshot,
  );
  const result = baseResult({
    task: options.task,
    workflowStatus: "failure",
    failureReason: "fan_out_plan_invalid",
    specDecision: options.decision,
    unresolvedQuestions: [],
    implementationStarted: false,
    implementation: null,
    specPhase: options.specPhase,
    plannerPhase: options.plannerPhase,
    planningEnabled: options.planningEnabled,
    subagentsEnabled: options.subagentsEnabled,
    contextMode: options.contextMode,
    conversationStateMode: options.conversationStateMode,
    contextPreparation: options.contextPreparation,
    receivedTerminalResponse: false,
    verificationAttempts: 0,
    repairAttempts: 0,
    repeatedFailure: false,
    verifications: [],
    repairs: [],
    finalVerificationPassed: false,
    finalVerification: null,
    modelFinalResponse: options.error,
    changedFiles,
    unifiedDiff,
    tracePath: options.tracer.tracePath,
    durationMs: Date.now() - options.startedAt,
    skillLoads: [],
    workspace: options.workspace,
    workflowId: options.workflowId,
  });
  options.tracer.record("harness_gate", {
    action: "abort",
    reason: "fan_out_plan_invalid",
    implementationStarted: false,
    fanOutPlanError: options.error,
  });
  persistDurableTerminal(options.durable, options.workflow, {
    workflowStatus: "failure",
    failureReason: "fan_out_plan_invalid",
  });
  await finishRun(options.tracer, result);
  return result;
}

function fanOutFailureReason(evidence: FanOutEvidence): WorkflowFailureReason {
  if (evidence.failureReason === "fan_in_conflict") {
    return "fan_in_conflict";
  }
  if (evidence.failureReason === "lost_changes") {
    return "fan_in_lost_changes";
  }
  return "child_verification_failed";
}

function fanOutFailureMessage(evidence: FanOutEvidence): string {
  if (evidence.fanIn.conflict) {
    return `Fan-in conflict on unit ${evidence.fanIn.conflict.failedUnitId}: ${evidence.fanIn.conflict.evidence}`;
  }
  if (evidence.fanIn.lostChanges.length > 0) {
    return `Fan-in lost changes: ${evidence.fanIn.lostChanges.join(", ")}`;
  }
  const failed = evidence.children.find((child) => !child.verificationPassed);
  return failed
    ? `Child ${failed.unitId} scoped VERIFY failed.`
    : "Fan-out implementation failed.";
}

async function runFanOutChildEpisode(options: {
  unit: FanOutUnit;
  config: HarnessConfig;
  originalTask: string;
  spec: Spec;
  plan: FanOutPlan;
  tracer: Tracer;
  reusableContext: ReusableContext | undefined;
  runId: string;
  conversationStateMode: ConversationStateMode;
  subagentsEnabled: boolean;
}): Promise<ChildEpisodeResult> {
  const startedAt = Date.now();
  const unitTask = formatWorkerFanOutUnitTask(
    options.originalTask,
    options.spec,
    options.plan,
    options.unit,
  );
  const beforeSnapshot = snapshotDirectory(options.config.targetSrcRoot);
  const { episode, verified } = await runScopedWorkerUnit({
    config: options.config,
    unitTask,
    spec: options.spec,
    tracer: options.tracer,
    reusableContext: options.reusableContext,
    runId: `${options.runId}-child-${options.unit.id}`,
    conversationStateMode: options.conversationStateMode,
    subagentsEnabled: options.subagentsEnabled,
    beforeSnapshot,
    testFiles: childVerificationFiles(options.unit),
  });
  return {
    episode: foldRepairsIntoImplementation(episode, verified.repairs),
    verificationPassed: verified.finalVerificationPassed,
    verificationOutput: verified.finalVerification?.output ?? "",
    repairAttempts: verified.repairAttempts,
    startedAt,
    finishedAt: Date.now(),
  };
}

async function runScopedWorkerUnit(options: {
  config: HarnessConfig;
  unitTask: string;
  spec: Spec;
  tracer: Tracer;
  reusableContext: ReusableContext | undefined;
  runId: string;
  conversationStateMode: ConversationStateMode;
  subagentsEnabled: boolean;
  beforeSnapshot: FileSnapshot;
  testFiles: string[];
}): Promise<{
  episode: AgentRunResult;
  verified: Awaited<ReturnType<typeof runVerifyRepairLoop>>;
}> {
  const episode = await runAgentLoop({
    config: options.config,
    task: options.unitTask,
    runId: options.runId,
    beforeSnapshot: options.beforeSnapshot,
    spec: options.spec,
    tracer: options.tracer,
    reusableContext: options.reusableContext,
    phase: "implementation",
    conversationStateMode: options.conversationStateMode,
    subagentsEnabled: options.subagentsEnabled,
  });
  const verified = await runVerifyRepairLoop({
    config: options.config,
    task: options.unitTask,
    spec: options.spec,
    tracer: options.tracer,
    reusableContext: options.reusableContext,
    runId: options.runId,
    implementation: episode,
    conversationStateMode: options.conversationStateMode,
    emitSuccessOutcome: false,
    verify: () => runScopedVerification(options.config, options.testFiles),
  });
  return { episode, verified };
}

async function runDecomposedImplementation(options: {
  config: HarnessConfig;
  task: string;
  spec: Spec;
  plan: ReviewPlan;
  templates: ChangeUnitTemplate[];
  tracer: Tracer;
  reusableContext: ReusableContext | undefined;
  runId: string;
  conversationStateMode: ConversationStateMode;
  subagentsEnabled: boolean;
  sourceBeforeSnapshot: FileSnapshot;
}): Promise<{
  implementation: AgentRunResult;
  units: ReviewUnitReport[];
  unitGateFailed: boolean;
  stoppedReviewUnitId: string | null;
}> {
  const units: ReviewUnitReport[] = [];
  const completedIds: string[] = [];
  let merged: AgentRunResult | null = null;
  let unitGateFailed = false;
  let stoppedReviewUnitId: string | null = null;

  for (const unit of orderedUnits(options.plan)) {
    const unitBefore = snapshotDirectory(options.config.targetSrcRoot);
    options.tracer.record("review_unit_started", {
      unitId: unit.id,
      intent: unit.intent,
      dependsOn: unit.dependsOn,
      acceptanceRefs: unit.acceptanceRefs,
    });

    const unitTask = formatWorkerUnitTask(
      options.task,
      options.spec,
      options.plan,
      unit,
    );
    completedIds.push(unit.id);
    const scopedFiles = cumulativeTestFiles(completedIds, options.templates);
    const { episode, verified: unitVerified } = await runScopedWorkerUnit({
      config: options.config,
      unitTask,
      spec: options.spec,
      tracer: options.tracer,
      reusableContext: options.reusableContext,
      runId: options.runId,
      conversationStateMode: options.conversationStateMode,
      subagentsEnabled: options.subagentsEnabled,
      beforeSnapshot: unitBefore,
      testFiles: scopedFiles,
    });
    merged = merged ? mergeAgentRuns(merged, episode) : episode;

    merged = foldRepairsIntoImplementation(merged, unitVerified.repairs);

    const afterRepair = snapshotDirectory(options.config.targetSrcRoot);
    const repairedDelta = diffSnapshots(unitBefore, afterRepair);
    const deviation = unitDeviation({
      emptyDiff: repairedDelta.changedFiles.length === 0,
      verificationPassed: unitVerified.finalVerificationPassed,
    });

    const report: ReviewUnitReport = {
      id: unit.id,
      intent: unit.intent,
      acceptanceRefs: unit.acceptanceRefs,
      dependsOn: unit.dependsOn,
      changedFiles: repairedDelta.changedFiles,
      unifiedDiff: repairedDelta.unifiedDiff,
      verificationPassed: unitVerified.finalVerificationPassed,
      verificationOutput: unitVerified.finalVerification?.output ?? "",
      repairAttempts: unitVerified.repairAttempts,
      modelCalls:
        episode.modelCalls +
        unitVerified.repairs.reduce((sum, item) => sum + item.modelCalls, 0),
      toolCalls:
        episode.toolCalls +
        unitVerified.repairs.reduce((sum, item) => sum + item.toolCalls, 0),
      durationMs:
        episode.durationMs +
        unitVerified.repairs.reduce((sum, item) => sum + item.durationMs, 0),
      deviation,
    };
    units.push(report);
    options.tracer.record("review_unit_completed", {
      unitId: unit.id,
      verificationPassed: report.verificationPassed,
      changedFiles: report.changedFiles,
      repairAttempts: report.repairAttempts,
      deviation: report.deviation,
    });

    if (!shouldContinueDecomposedUnits(report.verificationPassed)) {
      unitGateFailed = true;
      stoppedReviewUnitId = unit.id;
      options.tracer.record("review_unit_gate_stopped", {
        unitId: unit.id,
        remainingUnits: orderedUnits(options.plan)
          .map((item) => item.id)
          .filter((id) => !completedIds.includes(id)),
      });
      break;
    }
  }

  if (!merged) {
    throw new Error("decompose ReviewPlan produced no implementation episode.");
  }

  const finalSource = snapshotDirectory(options.config.targetSrcRoot);
  const full = diffSnapshots(options.sourceBeforeSnapshot, finalSource);
  merged.changedFiles = full.changedFiles;
  merged.unifiedDiff = full.unifiedDiff;
  return {
    implementation: merged,
    units,
    unitGateFailed,
    stoppedReviewUnitId,
  };
}

function unitDeviation(options: {
  emptyDiff: boolean;
  verificationPassed: boolean;
}): string | null {
  const parts: string[] = [];
  if (options.emptyDiff) {
    parts.push(
      "no source delta; work may have landed in an earlier unit or been skipped",
    );
  }
  if (!options.verificationPassed) {
    parts.push("unit verification failed after bounded repair");
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function mergeAgentRuns(
  left: AgentRunResult,
  right: AgentRunResult,
): AgentRunResult {
  return {
    ...right,
    turns: left.turns + right.turns,
    modelCalls: left.modelCalls + right.modelCalls,
    toolCalls: left.toolCalls + right.toolCalls,
    receivedTerminalResponse: right.receivedTerminalResponse,
    durationMs: left.durationMs + right.durationMs,
    discovery: {
      listFilesCalls:
        left.discovery.listFilesCalls + right.discovery.listFilesCalls,
      readFileCalls:
        left.discovery.readFileCalls + right.discovery.readFileCalls,
      readFilePaths: uniquePaths(
        left.discovery.readFilePaths,
        right.discovery.readFilePaths,
      ),
      listedPaths: uniquePaths(
        left.discovery.listedPaths,
        right.discovery.listedPaths,
      ),
    },
    implNavCallsBeforeFirstWrite:
      left.implNavCallsBeforeFirstWrite ?? right.implNavCallsBeforeFirstWrite,
    tokenUsage: combineTokenUsage(left.tokenUsage, right.tokenUsage),
    clientInputItemsSent:
      left.clientInputItemsSent + right.clientInputItemsSent,
    clientInputBytesSent:
      left.clientInputBytesSent + right.clientInputBytesSent,
    researchDelegations: [
      ...left.researchDelegations,
      ...right.researchDelegations,
    ],
  };
}

function foldRepairsIntoImplementation(
  implementation: AgentRunResult,
  repairs: RepairAttemptSummary[],
): AgentRunResult {
  if (repairs.length === 0) {
    return implementation;
  }
  return {
    ...implementation,
    turns:
      implementation.turns + repairs.reduce((sum, item) => sum + item.turns, 0),
    modelCalls:
      implementation.modelCalls +
      repairs.reduce((sum, item) => sum + item.modelCalls, 0),
    toolCalls:
      implementation.toolCalls +
      repairs.reduce((sum, item) => sum + item.toolCalls, 0),
    durationMs:
      implementation.durationMs +
      repairs.reduce((sum, item) => sum + item.durationMs, 0),
    tokenUsage: combineTokenUsage(
      implementation.tokenUsage,
      ...repairs.map((item) => item.tokenUsage),
    ),
    clientInputItemsSent:
      implementation.clientInputItemsSent +
      repairs.reduce((sum, item) => sum + (item.clientInputItemsSent ?? 0), 0),
    clientInputBytesSent:
      implementation.clientInputBytesSent +
      repairs.reduce((sum, item) => sum + (item.clientInputBytesSent ?? 0), 0),
  };
}

function uniquePaths(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
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
  verify?: () => VerificationResult;
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
    const verification = options.verify
      ? options.verify()
      : runFinalVerification(config);
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

    if (!normalized) {
      throw new Error(
        "Repair requires normalized verification failure evidence.",
      );
    }

    repairAttempts = decision.attempt;
    previousSignature = normalized.signature;
    const repairBefore = snapshotDirectory(config.targetSrcRoot);

    tracer.record("repair_started", {
      attempt: repairAttempts,
      ...routingTraceFields(resolveModel("repair", config)),
      conversationStateMode,
      maxRepairAttempts: config.maxRepairAttempts,
      specGoal: spec.goal,
      failedTests: normalized.failedTests,
      failureSignature: normalized.signature,
      promptIncludesSpec: true,
      promptIncludesFailureEvidence: true,
      promptPreview: truncate(
        formatRepairContract(task, spec, normalized),
        2000,
      ),
    });

    const repair = await runAgentLoop({
      config,
      task: formatRepairContract(task, spec, normalized),
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
  durable?: DurableRunOptions;
  workflow: WorkflowState | null;
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
  workflow: WorkflowState | null;
  lastRetryDecision?: RetryDecision;
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
    durable,
  } = options;
  let workflow = options.workflow;

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
  let lastRetryDecision: RetryDecision | undefined;

  const runReviewRound = async (
    round: number,
  ): Promise<
    | { ok: true; blockingKeys: string[] }
    | { ok: false; reason: WorkflowFailureReason }
    | {
        ok: false;
        paused: true;
        retry: DurableRetryState;
        decision: RetryDecision;
      }
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

    const runReview = () =>
      runIndependentReview({
        config,
        context,
        tracer,
        round,
      });

    const review = await executeRoundReview(round, context, runReview);
    if ("paused" in review) {
      return review;
    }
    if (!review.result) {
      tracer.record("review_completed", {
        round,
        parseOk: false,
        failureReason: review.failureReason ?? "invalid_review",
        modelCalls: review.modelCalls,
        durationMs: review.durationMs,
      });
      return {
        ok: false,
        reason: review.retryFailureReason ?? "review_parse_failed",
      };
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

  const executeRoundReview = async (
    round: number,
    context: ReviewContext,
    runReview: () => Promise<ReviewPhaseResult>,
  ): Promise<
    | (ReviewPhaseResult & { retryFailureReason?: WorkflowFailureReason })
    | {
        ok: false;
        paused: true;
        retry: DurableRetryState;
        decision: RetryDecision;
      }
  > => {
    if (!durable || workflow?.phase !== "review_ready") {
      return runReview();
    }

    const operationId = reviewOperationId(
      workflow.workflowId,
      logicalReviewId(workflow.reviewBaseline.artifactId, round),
    );
    const executed = await executeReviewWithRetry({
      operationId,
      currentRetry: workflow.retry,
      maxAttempts: DEFAULT_MAX_REVIEW_RETRY_ATTEMPTS,
      injectTransientOnAttempt: durable.injectReviewTransientFailureOnAttempt,
      stopAfterRetryAdmission: durable.stopAfterRetryAdmission,
      persistRetry: (retry) => {
        if (!durable || workflow?.phase !== "review_ready") {
          return;
        }
        workflow = persistReviewRetryState({
          durable,
          workflow,
          retry,
          tracer,
        });
      },
      runReview,
      onAttemptStarted: (retry) => {
        tracer.record("review_retry_attempt_started", {
          operationId: retry.operationId,
          operationKind: retry.operationKind,
          attemptsStarted: retry.attemptsStarted,
          maxAttempts: retry.maxAttempts,
          round,
          source: "harness_retry_policy",
        });
      },
      onInjectedFailure: (retry) => {
        tracer.record("review_started", {
          round,
          injectedTransientFailure: true,
          operationId: retry.operationId,
          attemptsStarted: retry.attemptsStarted,
          changedFiles: context.changedFiles,
          constraintIds: context.architectureConstraints.map((item) => item.id),
          verificationPassed: context.verificationEvidence.passed,
          promptIncludesSpec: true,
          promptIncludesDiff: true,
          promptIncludesConstraints: context.architectureConstraints.length > 0,
          promptIncludesVerificationEvidence: true,
        });
        tracer.record("review_retry_injected_failure", {
          operationId: retry.operationId,
          attemptsStarted: retry.attemptsStarted,
          failureClass: "retryable_transient",
          source: "harness",
        });
      },
      onClassified: ({ retry, failureClass, decision }) => {
        lastRetryDecision = decision;
        tracer.record("review_retry_classified", {
          operationId: retry.operationId,
          attemptsStarted: retry.attemptsStarted,
          failureClass,
          source: "harness",
        });
        tracer.record("review_retry_decision", {
          operationId: retry.operationId,
          attemptsStarted: retry.attemptsStarted,
          maxAttempts: retry.maxAttempts,
          action: decision.action,
          reason: "reason" in decision ? decision.reason : null,
          source: "harness_retry_policy",
        });
      },
    });

    if (executed.status === "paused") {
      lastRetryDecision = executed.decision;
      return {
        ok: false,
        paused: true,
        retry: executed.retry,
        decision: executed.decision,
      };
    }
    if (executed.status === "failed") {
      lastRetryDecision = executed.decision;
      return {
        result: null,
        parseOk: false,
        failureReason:
          executed.review.failureReason ??
          (executed.decision.action === "stop" &&
          executed.decision.reason === "semantic_domain"
            ? "invalid_review"
            : "model_error"),
        modelCalls: executed.review.modelCalls ?? 0,
        toolCalls: executed.review.toolCalls ?? 0,
        durationMs: executed.review.durationMs ?? 0,
        tokenUsage: executed.review.tokenUsage ?? null,
        modelFinalResponse: executed.review.modelFinalResponse ?? "",
        retryFailureReason:
          executed.decision.action === "needs_reconciliation"
            ? "retry_needs_reconciliation"
            : executed.decision.reason === "retry_budget_exhausted"
              ? "review_retry_exhausted"
              : "review_parse_failed",
      };
    }
    return executed.review;
  };

  const finish = (
    workflowStatus: WorkflowStatus,
    finalReviewerOutcome: ReviewRunState["finalReviewerOutcome"],
    extra?: {
      failureReason?: WorkflowFailureReason;
      repeatedFinding?: boolean;
      pausedForRetry?: boolean;
      durableRetry?: DurableRetryState;
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
    if (extra?.pausedForRetry) {
      tracer.record("durable_retry_paused", {
        workflowId: workflow?.workflowId ?? null,
        operationId: extra.durableRetry?.operationId ?? null,
        attemptsStarted: extra.durableRetry?.attemptsStarted ?? null,
        lastFailureClass: extra.durableRetry?.lastFailureClass ?? null,
        decision: lastRetryDecision ?? null,
        source: "harness_retry_policy",
      });
    } else {
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
    }
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
      workflow,
      lastRetryDecision,
    };
  };

  const first = await runReviewRound(1);
  if (!first.ok) {
    if ("paused" in first) {
      return finish("paused", "skipped", {
        pausedForRetry: true,
        durableRetry: first.retry,
      });
    }
    return finish("failure", "parse_failed", {
      failureReason: first.reason,
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
    if ("paused" in second) {
      return finish("paused", "skipped", {
        pausedForRetry: true,
        durableRetry: second.retry,
      });
    }
    return finish("failure", "parse_failed", {
      failureReason: second.reason,
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
  plannerPhase: {
    plan: Plan | null;
    turns: number;
    modelCalls: number;
    toolCalls: number;
    durationMs: number;
    tokenUsage: TokenUsageSummary | null;
  };
  planningEnabled: boolean;
  subagentsEnabled: boolean;
  reviewPlan?: ReviewPlan | null;
  reviewUnits?: ReviewUnitReport[];
  reviewabilityReportPath?: string | null;
  reviewUnitGateFailed?: boolean;
  stoppedReviewUnitId?: string | null;
  fanOut?: FanOutEvidence | null;
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
  workflowId?: string;
  durableRetry?: DurableRetryState;
  lastRetryDecision?: RetryDecision;
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

  const researchDelegations = implementation?.researchDelegations ?? [];
  const researchTokenUsage = researchDelegations.map(
    (item) => item.childTokenUsage,
  );
  const researchTurns = researchDelegations.reduce(
    (sum, item) => sum + item.childTurns,
    0,
  );
  const researchModelCalls = researchDelegations.reduce(
    (sum, item) => sum + item.childModelCalls,
    0,
  );
  const researchToolCalls = researchDelegations.reduce(
    (sum, item) => sum + item.childToolCalls,
    0,
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
      fields.plannerPhase.tokenUsage,
      implementation?.tokenUsage ?? null,
      ...researchTokenUsage,
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
    planningEnabled: fields.planningEnabled,
    plan: fields.plannerPhase.plan,
    plannerTurns: fields.plannerPhase.turns,
    plannerModelCalls: fields.plannerPhase.modelCalls,
    plannerToolCalls: fields.plannerPhase.toolCalls,
    plannerDurationMs: fields.plannerPhase.durationMs,
    subagentsEnabled: fields.subagentsEnabled,
    reviewPlan: fields.reviewPlan ?? null,
    reviewUnits: fields.reviewUnits ?? [],
    reviewabilityReportPath: fields.reviewabilityReportPath ?? null,
    reviewUnitGateFailed: fields.reviewUnitGateFailed ?? false,
    stoppedReviewUnitId: fields.stoppedReviewUnitId ?? null,
    fanOut: fields.fanOut ?? null,
    turns:
      fields.specPhase.turns +
      fields.plannerPhase.turns +
      (implementation?.turns ?? 0) +
      researchTurns +
      repairTurns +
      reviewRepairTurns,
    modelCalls:
      fields.specPhase.modelCalls +
      fields.plannerPhase.modelCalls +
      (implementation?.modelCalls ?? 0) +
      researchModelCalls +
      repairModelCalls +
      reviewModelCalls +
      reviewRepairModelCalls,
    toolCalls:
      fields.specPhase.toolCalls +
      fields.plannerPhase.toolCalls +
      (implementation?.toolCalls ?? 0) +
      researchToolCalls +
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
    ...(fields.workflowId ? { workflowId: fields.workflowId } : {}),
    ...(fields.durableRetry ? { durableRetry: fields.durableRetry } : {}),
    ...(fields.lastRetryDecision
      ? { lastRetryDecision: fields.lastRetryDecision }
      : {}),
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
    planningEnabled: result.planningEnabled,
    plan: result.plan,
    plannerModelCalls: result.plannerModelCalls,
    plannerToolCalls: result.plannerToolCalls,
    plannerDurationMs: result.plannerDurationMs,
    subagentsEnabled: result.subagentsEnabled,
    reviewPlan: result.reviewPlan,
    reviewUnits: result.reviewUnits.map((unit) => ({
      id: unit.id,
      intent: unit.intent,
      acceptanceRefs: unit.acceptanceRefs,
      dependsOn: unit.dependsOn,
      changedFiles: unit.changedFiles,
      verificationPassed: unit.verificationPassed,
      repairAttempts: unit.repairAttempts,
      modelCalls: unit.modelCalls,
      toolCalls: unit.toolCalls,
      durationMs: unit.durationMs,
      diffLines: unit.unifiedDiff.split("\n").length,
      deviation: unit.deviation,
    })),
    reviewabilityReportPath: result.reviewabilityReportPath,
    reviewUnitGateFailed: result.reviewUnitGateFailed,
    stoppedReviewUnitId: result.stoppedReviewUnitId,
    fanOut: result.fanOut
      ? {
          schedule: result.fanOut.schedule,
          ok: result.fanOut.ok,
          failureReason: result.fanOut.failureReason,
          writeSetOverlap: result.fanOut.writeSetOverlap,
          childIntervalMs: result.fanOut.childIntervalMs,
          childDurationSumMs: result.fanOut.childDurationSumMs,
          provenance: result.fanOut.provenance,
          fanIn: result.fanOut.fanIn,
          children: result.fanOut.children.map((child) => ({
            unitId: child.unitId,
            baseRevision: child.baseRevision,
            changedFiles: child.changedFiles,
            verificationPassed: child.verificationPassed,
            repairAttempts: child.repairAttempts,
            durationMs: child.durationMs,
            modelCalls: child.modelCalls,
            toolCalls: child.toolCalls,
          })),
        }
      : null,
    researchDelegations: result.implementation?.researchDelegations ?? [],
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

function assertDurableModeSupported(options: {
  planningEnabled?: boolean;
  subagentsEnabled?: boolean;
  bindReviewPlan?: unknown;
  bindFanOutPlan?: unknown;
  admittedSpec?: unknown;
}): void {
  if (options.planningEnabled) {
    throw new WorkflowError(
      "unsupported_mode",
      "Durable execution does not support planningEnabled.",
    );
  }
  if (options.subagentsEnabled) {
    throw new WorkflowError(
      "unsupported_mode",
      "Durable execution does not support subagentsEnabled.",
    );
  }
  if (options.bindReviewPlan) {
    throw new WorkflowError(
      "unsupported_mode",
      "Durable execution does not support ReviewPlan decomposition.",
    );
  }
  if (options.bindFanOutPlan) {
    throw new WorkflowError(
      "unsupported_mode",
      "Durable execution does not support FanOutPlan.",
    );
  }
  if (options.admittedSpec) {
    throw new WorkflowError(
      "unsupported_mode",
      "Durable execution does not support pre-admitted Spec injection.",
    );
  }
}

async function continueAfterVerifiedImplementation(options: {
  config: HarnessConfig;
  task: string;
  runId: string;
  tracer: Tracer;
  startedAt: number;
  conversationStateMode: ConversationStateMode;
  architectureConstraints?: ArchitectureConstraint[];
  workspace?: Workspace;
  durable?: DurableRunOptions;
  workflow: ReviewReadyState;
}): Promise<HarnessRunResult> {
  const {
    config,
    task,
    runId,
    tracer,
    startedAt,
    conversationStateMode,
    durable,
  } = options;
  let workflow = options.workflow;
  const workspace = options.workspace;
  const contextMode = workflow.contextMode;
  const specPhase = resumedSpecPhase(workflow);

  tracer.record("spec_phase_skipped", {
    reason: "durable_resume_review_ready",
    workflowId: workflow.workflowId,
    pid: process.pid,
    invocationId: runId,
  });
  tracer.record("implementation_skipped", {
    reason: "durable_resume_review_ready",
    workflowId: workflow.workflowId,
    pid: process.pid,
    invocationId: runId,
  });
  tracer.record("pre_review_verify_skipped", {
    reason: "durable_resume_review_ready",
    workflowId: workflow.workflowId,
    verification: workflow.verification,
  });
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
    planningEnabled: false,
    subagentsEnabled: false,
    repoRoot: config.repoRoot,
    targetAppRoot: config.targetAppRoot,
    targetSrcRoot: config.targetSrcRoot,
    pid: process.pid,
    specSkipped: true,
    implementationSkipped: true,
    preReviewVerifySkipped: true,
    workflowId: durable?.workflowId ?? workflow.workflowId,
    durablePhase: "review_ready",
    invocationId: runId,
    ...(workspace
      ? {
          workspace: {
            id: workspace.id,
            root: workspace.root,
            baseRevision: workspace.baseRevision,
            ref: workspace.ref,
          },
        }
      : {}),
  });

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
      recomputedOnResume: true,
    });
  }

  if (!durable) {
    throw new WorkflowError(
      "unsupported_mode",
      "review_ready resume requires durable execution options.",
    );
  }
  const beforeSnapshot = loadReviewBaseline(
    durable.storeDir,
    workflow.reviewBaseline,
  );
  const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
  const { changedFiles, unifiedDiff } = diffSnapshots(
    beforeSnapshot,
    afterSnapshot,
  );
  const lastVerification: VerificationResult = {
    passed: true,
    exitCode: workflow.verification.exitCode,
    output: "",
    durationMs: workflow.verification.durationMs,
  };

  tracer.record("review_ready_resumed", {
    workflowId: workflow.workflowId,
    workspaceValidated: true,
    reviewBaselineRestored: true,
    workerSkipped: true,
    preReviewVerifySkipped: true,
    baselineFingerprint: workflow.reviewBaseline.fingerprint,
    workspaceFingerprint: workflow.workspace.workingTreeFingerprint,
    verification: workflow.verification,
  });
  const reconstructed = reviewDeltaIdentity(changedFiles, unifiedDiff);
  tracer.record("review_input_reconstructed", {
    workflowId: workflow.workflowId,
    changedFiles: reconstructed.changedFiles,
    unifiedDiffBytes: unifiedDiff.length,
    diffFingerprint: reconstructed.diffFingerprint,
    baselineFingerprint: workflow.reviewBaseline.fingerprint,
    verification: workflow.verification,
  });

  const reusableContext: ReusableContext | undefined =
    contextMode === "variant" && repositoryMap
      ? {
          repositoryMap,
          specInspectedPaths: workflow.specInspectedPaths,
        }
      : undefined;

  const implementation = resumedImplementationStub(task, tracer.tracePath);
  const reviewed = await runIndependentReviewLoop({
    config,
    task,
    spec: workflow.spec,
    tracer,
    reusableContext,
    runId,
    implementation,
    beforeSnapshot,
    architectureConstraints: options.architectureConstraints ?? [],
    lastVerification,
    lastVerificationAttempt: workflow.verification.attempt,
    conversationStateMode,
    durable,
    workflow,
  });
  workflow =
    reviewed.workflow?.phase === "review_ready" ? reviewed.workflow : workflow;

  const result = baseResult({
    task,
    workflowStatus: reviewed.workflowStatus,
    failureReason: reviewed.failureReason,
    specDecision: { status: "executable", spec: workflow.spec },
    unresolvedQuestions: [],
    implementationStarted: false,
    implementation: null,
    specPhase,
    plannerPhase: emptyPlannerPhase(),
    planningEnabled: false,
    subagentsEnabled: false,
    contextMode,
    conversationStateMode,
    contextPreparation,
    receivedTerminalResponse:
      reviewed.reviewState.finalReviewerOutcome === "pass",
    verificationAttempts:
      workflow.verification.attempt + reviewed.extraVerificationAttempts,
    repairAttempts: reviewed.extraRepairAttempts,
    repeatedFailure: reviewed.repeatedFailure,
    verifications: [
      {
        attempt: workflow.verification.attempt,
        passed: true,
        exitCode: workflow.verification.exitCode,
        durationMs: workflow.verification.durationMs,
        normalizedFailure: null,
      },
      ...reviewed.extraVerifications,
    ],
    repairs: reviewed.extraRepairs,
    review: reviewed.reviewState,
    finalVerificationPassed: reviewed.finalVerificationPassed,
    finalVerification: reviewed.finalVerification,
    modelFinalResponse: reviewed.modelFinalResponse,
    changedFiles,
    unifiedDiff,
    tracePath: tracer.tracePath,
    durationMs: Date.now() - startedAt,
    skillLoads: reviewed.skillLoads,
    workspace,
    workflowId: workflow.workflowId,
    durableRetry: workflow.retry,
    lastRetryDecision: reviewed.lastRetryDecision,
  });
  result.implementationSkipped = true;
  result.preReviewVerifySkipped = true;
  result.reviewBaselineRestored = true;
  if (result.workflowStatus !== "paused") {
    persistDurableTerminal(durable, workflow, {
      workflowStatus: result.workflowStatus,
      failureReason: result.failureReason,
    });
  }
  await finishRun(tracer, result);
  return result;
}

function persistImplementationReady(options: {
  durable?: DurableRunOptions;
  workflow: WorkflowState;
  decision: Extract<SpecDecision, { status: "executable" }>;
  specInspectedPaths: InspectedPaths;
  contextMode: ContextMode;
  tracer: Tracer;
}): WorkflowState {
  if (!options.durable) {
    return options.workflow;
  }
  const next = admitImplementationReady({
    current: options.workflow,
    decision: options.decision,
    specInspectedPaths: options.specInspectedPaths,
    contextMode: options.contextMode,
  });
  persistOwnedState(options.durable, next);
  options.tracer.record("durable_transition", {
    from: options.workflow.phase,
    to: next.phase,
    workflowId: next.workflowId,
    pid: process.pid,
    persisted: true,
  });
  return next;
}

function persistReviewReadyCheckpoint(options: {
  durable: DurableRunOptions;
  workflow: WorkflowState;
  workspace: Workspace;
  reviewBaseline: ReviewReadyState["reviewBaseline"];
  verification: ReviewReadyState["verification"];
  tracer: Tracer;
}): WorkflowState {
  const next = admitReviewReady({
    current: options.workflow,
    workspace: captureWorkspaceResumeEvidence(options.workspace),
    reviewBaseline: options.reviewBaseline,
    verification: options.verification,
  });
  persistOwnedState(options.durable, next);
  options.tracer.record("durable_transition", {
    from: options.workflow.phase,
    to: next.phase,
    workflowId: next.workflowId,
    pid: process.pid,
    persisted: true,
  });
  return next;
}

function persistReviewRetryState(options: {
  durable: DurableRunOptions;
  workflow: ReviewReadyState;
  retry: DurableRetryState | undefined;
  tracer: Tracer;
}): ReviewReadyState {
  const next = admitReviewRetryState({
    current: options.workflow,
    retry: options.retry,
  });
  persistOwnedState(options.durable, next);
  options.tracer.record("durable_retry_state", {
    workflowId: next.workflowId,
    operationId: next.retry?.operationId ?? null,
    attemptsStarted: next.retry?.attemptsStarted ?? 0,
    maxAttempts: next.retry?.maxAttempts ?? null,
    lastFailureClass: next.retry?.lastFailureClass ?? null,
    cleared: !next.retry,
    pid: process.pid,
    persisted: true,
  });
  return next;
}

function persistDurableTerminal(
  durable: DurableRunOptions | undefined,
  workflow: WorkflowState | null,
  outcome: {
    workflowStatus: Exclude<WorkflowStatus, "paused">;
    failureReason?: WorkflowFailureReason;
  },
): void {
  if (!durable || !workflow) {
    return;
  }
  const next = admitTerminal({ current: workflow, outcome });
  persistOwnedState(durable, next);
}

function persistOwnedState(
  durable: DurableRunOptions,
  state: WorkflowState,
): void {
  const lease = durable.lease;
  if (!lease) {
    throw new Error("Harness bug: durable persist without acquired lease.");
  }
  saveWorkflowStateOwned({
    storeDir: durable.storeDir,
    state,
    lease,
    now: durableNowMs(durable),
  });
}

function durableNowMs(durable: DurableRunOptions): number {
  return durable.nowMs?.() ?? systemNowMs();
}

async function pausedAfterSpec(options: {
  task: string;
  specPhase: {
    turns: number;
    modelCalls: number;
    toolCalls: number;
    inspectedPaths: InspectedPaths;
    discovery: PhaseDiscoveryMetrics;
    tokenUsage: TokenUsageSummary | null;
    modelFinalResponse?: string;
  };
  decision: Extract<SpecDecision, { status: "executable" }>;
  planningEnabled: boolean;
  subagentsEnabled: boolean;
  contextMode: ContextMode;
  conversationStateMode: ConversationStateMode;
  contextPreparation: ContextPreparation | null;
  tracer: Tracer;
  startedAt: number;
  beforeSnapshot: FileSnapshot;
  workspace?: Workspace;
  workflowId: string;
}): Promise<HarnessRunResult> {
  const { changedFiles, unifiedDiff } = diffSnapshots(
    options.beforeSnapshot,
    options.beforeSnapshot,
  );
  const result = baseResult({
    task: options.task,
    workflowStatus: "paused",
    specDecision: options.decision,
    unresolvedQuestions: [],
    implementationStarted: false,
    implementation: null,
    specPhase: options.specPhase,
    plannerPhase: emptyPlannerPhase(),
    planningEnabled: options.planningEnabled,
    subagentsEnabled: options.subagentsEnabled,
    contextMode: options.contextMode,
    conversationStateMode: options.conversationStateMode,
    contextPreparation: options.contextPreparation,
    receivedTerminalResponse: false,
    verificationAttempts: 0,
    repairAttempts: 0,
    repeatedFailure: false,
    verifications: [],
    repairs: [],
    finalVerificationPassed: false,
    finalVerification: null,
    modelFinalResponse:
      options.specPhase.modelFinalResponse ??
      "durable_checkpoint:implementation_ready",
    changedFiles,
    unifiedDiff,
    tracePath: options.tracer.tracePath,
    durationMs: Date.now() - options.startedAt,
    skillLoads: [],
    workspace: options.workspace,
    workflowId: options.workflowId,
  });
  result.durableCheckpoint = "implementation_ready";
  options.tracer.record("durable_checkpoint", {
    phase: "implementation_ready",
    workflowId: options.workflowId,
    pid: process.pid,
    stopAfter: "implementation_ready",
  });
  await finishRun(options.tracer, result);
  return result;
}

async function pausedAfterReviewReady(options: {
  task: string;
  specPhase: {
    turns: number;
    modelCalls: number;
    toolCalls: number;
    inspectedPaths: InspectedPaths;
    discovery: PhaseDiscoveryMetrics;
    tokenUsage: TokenUsageSummary | null;
    modelFinalResponse?: string;
  };
  decision: Extract<SpecDecision, { status: "executable" }>;
  planningEnabled: boolean;
  subagentsEnabled: boolean;
  contextMode: ContextMode;
  conversationStateMode: ConversationStateMode;
  contextPreparation: ContextPreparation | null;
  tracer: Tracer;
  startedAt: number;
  beforeSnapshot: FileSnapshot;
  implementation: AgentRunResult;
  verifications: VerificationAttempt[];
  repairs: RepairAttemptSummary[];
  verificationAttempts: number;
  repairAttempts: number;
  repeatedFailure: boolean;
  finalVerification: VerificationResult;
  workspace?: Workspace;
  workflowId: string;
}): Promise<HarnessRunResult> {
  const current = options.workspace
    ? snapshotDirectory(path.join(options.workspace.root, "target-app", "src"))
    : options.beforeSnapshot;
  const { changedFiles, unifiedDiff } = diffSnapshots(
    options.beforeSnapshot,
    current,
  );
  const result = baseResult({
    task: options.task,
    workflowStatus: "paused",
    specDecision: options.decision,
    unresolvedQuestions: [],
    implementationStarted: true,
    implementation: options.implementation,
    specPhase: options.specPhase,
    plannerPhase: emptyPlannerPhase(),
    planningEnabled: options.planningEnabled,
    subagentsEnabled: options.subagentsEnabled,
    contextMode: options.contextMode,
    conversationStateMode: options.conversationStateMode,
    contextPreparation: options.contextPreparation,
    receivedTerminalResponse: options.implementation.receivedTerminalResponse,
    verificationAttempts: options.verificationAttempts,
    repairAttempts: options.repairAttempts,
    repeatedFailure: options.repeatedFailure,
    verifications: options.verifications,
    repairs: options.repairs,
    finalVerificationPassed: true,
    finalVerification: options.finalVerification,
    modelFinalResponse: "durable_checkpoint:review_ready",
    changedFiles,
    unifiedDiff,
    tracePath: options.tracer.tracePath,
    durationMs: Date.now() - options.startedAt,
    skillLoads: collectedSkillLoads(options.implementation),
    workspace: options.workspace,
    workflowId: options.workflowId,
  });
  result.durableCheckpoint = "review_ready";
  options.tracer.record("durable_checkpoint", {
    phase: "review_ready",
    workflowId: options.workflowId,
    pid: process.pid,
    stopAfter: "review_ready",
  });
  await finishRun(options.tracer, result);
  return result;
}

function resumedSpecPhase(state: ImplementationReadyState | ReviewReadyState): {
  turns: number;
  modelCalls: number;
  toolCalls: number;
  inspectedPaths: InspectedPaths;
  discovery: PhaseDiscoveryMetrics;
  tokenUsage: TokenUsageSummary | null;
} {
  return {
    turns: 0,
    modelCalls: 0,
    toolCalls: 0,
    inspectedPaths: state.specInspectedPaths,
    discovery: {
      listFilesCalls: 0,
      readFileCalls: 0,
      readFilePaths: state.specInspectedPaths.readFiles,
      listedPaths: state.specInspectedPaths.listedPaths,
    },
    tokenUsage: null,
  };
}

function resumedImplementationStub(
  task: string,
  tracePath: string,
): AgentRunResult {
  return {
    task,
    phase: "implementation",
    status: "success",
    turns: 0,
    modelCalls: 0,
    toolCalls: 0,
    receivedTerminalResponse: true,
    modelFinalResponse: "durable_resume_review_ready",
    changedFiles: [],
    unifiedDiff: "",
    tracePath,
    durationMs: 0,
    discovery: {
      listFilesCalls: 0,
      readFileCalls: 0,
      readFilePaths: [],
      listedPaths: [],
    },
    implNavCallsBeforeFirstWrite: null,
    tokenUsage: null,
    skillLoad: null,
    conversationStateMode: "manual",
    clientInputItemsSent: 0,
    clientInputBytesSent: 0,
    researchDelegations: [],
  };
}

function pathMismatch(left: string, right: string): boolean {
  return path.resolve(left) !== path.resolve(right);
}

function emptyFrozenSpecPhase(
  decision: Extract<SpecDecision, { status: "executable" }>,
): SpecPhaseResult {
  return {
    decision,
    turns: 0,
    modelCalls: 0,
    toolCalls: 0,
    modelFinalResponse: "",
    durationMs: 0,
    inspectedPaths: { readFiles: [], listedPaths: [] },
    discovery: {
      listFilesCalls: 0,
      readFileCalls: 0,
      readFilePaths: [],
      listedPaths: [],
    },
    tokenUsage: null,
  };
}

function emptyPlannerPhase(): PlannerPhaseResult {
  return {
    plan: null,
    turns: 0,
    modelCalls: 0,
    toolCalls: 0,
    durationMs: 0,
    inspectedPaths: { readFiles: [], listedPaths: [] },
    discovery: {
      listFilesCalls: 0,
      readFileCalls: 0,
      readFilePaths: [],
      listedPaths: [],
    },
    tokenUsage: null,
    modelFinalResponse: "",
  };
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
