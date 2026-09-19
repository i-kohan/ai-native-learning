import type { HarnessConfig } from "./config.ts";
import { admitCurrentHeadCi, classifyCiEvidence } from "./ci-admission.ts";
import {
  acceptDeliveryCandidate,
  ensureCiWorkflow,
  repairFromCiEvidence,
  type DeliveryRepairFn,
  type DeliveryReviewFn,
  type DeliveryVerifyFn,
} from "./delivery-accept.ts";
import { DeliveryError } from "./delivery-error.ts";
import {
  admitBranchReconciled,
  admitCiObservation,
  admitCiRepairStarted,
  admitCiWaiting,
  admitDeliveryFailed,
  admitHeadCommitted,
  admitPrReconciled,
  admitReadyForHumanReview,
  createLocalAcceptedDelivery,
  type CiConclusion,
  type CiObservation,
  type DeliveryState,
} from "./delivery-state.ts";
import {
  deliveryStateExists,
  initializeDeliveryState,
  loadDeliveryState,
  saveDeliveryStateOwned,
} from "./delivery-store.ts";
import { loadReviewBaseline } from "./review-baseline.ts";
import { snapshotDirectory, type FileSnapshot } from "./diff.ts";
import { createDeliveryGit, type DeliveryGit } from "./delivery-git.ts";
import {
  deliveryPrBody,
  reconcileDraftPull,
  reconcileRemoteBranch,
} from "./github-delivery.ts";
import type { GitHubClient } from "./github-client.ts";
import { redactSecrets, truncateEvidence } from "./github-redact.ts";
import { Tracer } from "./trace.ts";
import { runFinalVerification } from "./verify.ts";
import { bindConfig, bindResumedWorkspace } from "./workspace.ts";
import {
  acquireWorkflowLease,
  assertCurrentOwner,
  createWorkflowOwnerId,
  DEFAULT_WORKFLOW_LEASE_TTL_MS,
  loadWorkflowLeaseRecord,
  releaseWorkflowLease,
} from "./workflow-lease-store.ts";
import type { WorkflowLease } from "./workflow-lease.ts";
import { loadWorkflowState } from "./workflow-store.ts";
import type { Spec } from "./spec.ts";
import type { ReviewBaselineRef, TerminalState } from "./workflow-state.ts";

export type DeliveryRunResult = {
  workflowId: string;
  delivery: DeliveryState;
  outcome: DeliveryState["deliveryPhase"];
};

export type DeliveryRunOptions = {
  config: HarnessConfig;
  storeDir: string;
  workflowId: string;
  hostRepoRoot: string;
  github: GitHubClient;
  repository: string;
  issueNumber: number;
  issueUrl: string;
  defaultBranch: string;
  spec: Spec;
  reviewBaseline: ReviewBaselineRef;
  runId: string;
  git?: DeliveryGit;
  verify?: DeliveryVerifyFn;
  review?: DeliveryReviewFn;
  repair?: DeliveryRepairFn;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  ciPollIntervalMs?: number;
  ciPollTimeoutMs?: number;
  leaseTtlMs?: number;
};

/**
 * Post-terminal GitHub delivery. Does not reopen runV1Harness().
 *
 * WorkflowState fencing does NOT fence GitHub. There remains a
 * check→external-action race because GitHub does not enforce our fencing token.
 * Mitigation: ownership check + deterministic identity + expected remote head +
 * no force push + reconciliation. This is not exactly-once or consensus.
 */
export async function runDelivery(
  options: DeliveryRunOptions,
): Promise<DeliveryRunResult> {
  const nowMs = options.nowMs ?? Date.now;
  const acquired = acquireWorkflowLease({
    storeDir: options.storeDir,
    workflowId: options.workflowId,
    ownerId: createWorkflowOwnerId(),
    ttlMs: options.leaseTtlMs ?? DEFAULT_WORKFLOW_LEASE_TTL_MS,
    now: nowMs(),
  });
  if (!acquired.ok) {
    throw new DeliveryError(
      "lease_held",
      `Workflow ${options.workflowId} is already owned by another invocation.`,
    );
  }
  const lease = acquired.lease;
  try {
    return await executeDelivery({ ...options, lease, nowMs });
  } finally {
    releaseWorkflowLease({ storeDir: options.storeDir, lease });
  }
}

async function executeDelivery(
  options: DeliveryRunOptions & {
    lease: WorkflowLease;
    nowMs: () => number;
  },
): Promise<DeliveryRunResult> {
  const tracer = new Tracer(options.config.tracesDir, options.runId);
  tracer.record("delivery_started", {
    workflowId: options.workflowId,
    ownerId: options.lease.ownerId,
    fencingToken: options.lease.fencingToken,
    note: "WorkflowState fencing does not fence GitHub.",
  });

  let state = loadOrInitializeDelivery(options);
  const workspaceRoot = state.workspace.root;
  const config = bindConfig(options.config, {
    id: state.workspace.id,
    root: workspaceRoot,
    baseRevision: state.workspace.baseRevision,
    ref: state.workspace.ref,
  });
  const git = options.git ?? createDeliveryGit();
  const baseline = loadReviewBaseline(options.storeDir, state.reviewBaseline);

  try {
    for (let step = 0; step < 12; step += 1) {
      if (
        state.deliveryPhase === "ready_for_human_review" ||
        state.deliveryPhase === "delivery_failed"
      ) {
        break;
      }
      state = await dispatchDeliveryPhase({
        ...options,
        config,
        state,
        git,
        baseline,
        tracer,
        workspaceRoot,
      });
    }
  } catch (error) {
    if (
      error instanceof DeliveryError &&
      state.deliveryPhase !== "ready_for_human_review" &&
      state.deliveryPhase !== "delivery_failed"
    ) {
      state = persist(
        options,
        admitDeliveryFailed({
          current: state,
          failureReason: redactSecrets(error.message),
        }),
      );
    } else {
      await tracer.close();
      throw error;
    }
  }

  tracer.record("delivery_completed", {
    workflowId: state.workflowId,
    deliveryPhase: state.deliveryPhase,
    expectedHeadSha: state.expectedHeadSha ?? null,
    prNumber: state.prNumber ?? null,
    ciRepairAttempts: state.ciRepairAttempts,
  });
  await tracer.close();
  return {
    workflowId: state.workflowId,
    delivery: state,
    outcome: state.deliveryPhase,
  };
}

async function dispatchDeliveryPhase(
  options: DeliveryRunOptions & {
    lease: WorkflowLease;
    nowMs: () => number;
    config: HarnessConfig;
    state: DeliveryState;
    git: DeliveryGit;
    baseline: FileSnapshot;
    tracer: Tracer;
    workspaceRoot: string;
  },
): Promise<DeliveryState> {
  const { state } = options;
  if (state.deliveryPhase === "local_accepted") {
    return commitLocallyAccepted(options);
  }
  if (state.deliveryPhase === "head_committed") {
    return publishBranch(options);
  }
  if (state.deliveryPhase === "branch_reconciled") {
    return openOrReusePull(options);
  }
  if (state.deliveryPhase === "pr_reconciled") {
    return persist(options, admitCiWaiting({ current: state }));
  }
  if (state.deliveryPhase === "ci_waiting") {
    return waitForCurrentHeadCi(options);
  }
  return state;
}

function loadOrInitializeDelivery(
  options: DeliveryRunOptions & { lease: WorkflowLease; nowMs: () => number },
): DeliveryState {
  const workflow = loadWorkflowState(options.storeDir, options.workflowId);
  if (workflow.phase !== "terminal") {
    throw new DeliveryError(
      "illegal_transition",
      `Delivery requires a terminal WorkflowState, got ${workflow.phase}.`,
    );
  }
  if (workflow.outcome.workflowStatus !== "success") {
    throw new DeliveryError(
      "illegal_transition",
      "Delivery requires a successful terminal workflow.",
    );
  }
  if (deliveryStateExists(options.storeDir, options.workflowId)) {
    return loadDeliveryState(options.storeDir, options.workflowId);
  }

  bindResumedWorkspace({
    hostRepoRoot: options.hostRepoRoot,
    config: options.config,
    expected: workflow.workspace,
  });
  const bound = bindConfig(options.config, {
    id: workflow.workspace.id,
    root: workflow.workspace.root,
    baseRevision: workflow.workspace.baseRevision,
    ref: workflow.workspace.ref,
  });
  const verification = (options.verify ?? runFinalVerification)(bound);
  if (!verification.passed) {
    throw new DeliveryError(
      "delivery_failed",
      "Fresh local VERIFY of the terminal artifact failed.",
    );
  }
  ensureCiWorkflow(workflow.workspace.root, options.hostRepoRoot);
  const created = createLocalAcceptedDelivery({
    workflowId: options.workflowId,
    repository: options.repository,
    issueNumber: options.issueNumber,
    issueUrl: options.issueUrl,
    defaultBranch: options.defaultBranch,
    baseSha: workflow.workspace.baseRevision,
    spec: options.spec,
    reviewBaseline: options.reviewBaseline,
    workspace: workflow.workspace,
    task: workflow.task,
  });
  return initializeDeliveryState({
    storeDir: options.storeDir,
    state: created,
  });
}

async function commitLocallyAccepted(options: {
  storeDir: string;
  lease: WorkflowLease;
  nowMs: () => number;
  config: HarnessConfig;
  state: DeliveryState;
  git: DeliveryGit;
  baseline: FileSnapshot;
  tracer: Tracer;
  workspaceRoot: string;
  verify?: DeliveryVerifyFn;
  review?: DeliveryReviewFn;
}): Promise<DeliveryState> {
  await acceptDeliveryCandidate({
    config: options.config,
    spec: options.state.spec,
    baseline: options.baseline,
    tracer: options.tracer,
    verify: options.verify,
    review: options.review,
  });
  const sha = options.git.commitAcceptedTree(
    options.workspaceRoot,
    deliveryCommitMessage(options.state),
  );
  return persist(
    options,
    admitHeadCommitted({ current: options.state, expectedHeadSha: sha }),
  );
}

async function publishBranch(options: {
  storeDir: string;
  lease: WorkflowLease;
  nowMs: () => number;
  github: GitHubClient;
  state: DeliveryState;
  git: DeliveryGit;
  workspaceRoot: string;
}): Promise<DeliveryState> {
  assertOwnership(options);
  const published = await reconcileRemoteBranch({
    github: options.github,
    state: options.state,
    pushLocal: () => {
      assertOwnership(options);
      options.git.pushBranch(options.workspaceRoot, options.state.branch);
    },
  });
  return persist(
    options,
    admitBranchReconciled({
      current: options.state,
      publishedHeadSha: published,
    }),
  );
}

async function openOrReusePull(options: {
  storeDir: string;
  lease: WorkflowLease;
  nowMs: () => number;
  github: GitHubClient;
  state: DeliveryState;
}): Promise<DeliveryState> {
  assertOwnership(options);
  const pull = await reconcileDraftPull({
    github: options.github,
    state: options.state,
    title: `agent/${options.state.workflowId}: ${options.state.task.split("\n")[0]}`,
    body: deliveryPrBody(options.state),
  });
  if (pull.merged) {
    throw new DeliveryError(
      "illegal_transition",
      "Reconciled PR is merged; delivery has no merge authority and will not continue.",
    );
  }
  return persist(
    options,
    admitPrReconciled({ current: options.state, prNumber: pull.number }),
  );
}

async function waitForCurrentHeadCi(
  options: DeliveryRunOptions & {
    lease: WorkflowLease;
    nowMs: () => number;
    config: HarnessConfig;
    state: DeliveryState;
    git: DeliveryGit;
    baseline: FileSnapshot;
    tracer: Tracer;
    workspaceRoot: string;
  },
): Promise<DeliveryState> {
  const timeoutMs = options.ciPollTimeoutMs ?? 15 * 60 * 1000;
  const intervalMs = options.ciPollIntervalMs ?? 10_000;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = options.nowMs() + timeoutMs;
  let state = options.state;

  while (options.nowMs() < deadline) {
    const observation = await observeCurrentHeadCi(options, state);
    if (!observation) {
      await sleep(intervalMs);
      continue;
    }
    state = persist(
      options,
      admitCiObservation({ current: state, observation }),
    );
    const admission = admitCurrentHeadCi({ state, observation });
    if (
      admission.action === "ignore_stale" ||
      admission.action === "reobserve"
    ) {
      await sleep(intervalMs);
      continue;
    }
    if (admission.action === "ready_for_human_review") {
      return persist(
        options,
        admitReadyForHumanReview({ current: state, observation }),
      );
    }
    if (admission.action === "fail") {
      return persist(
        options,
        admitDeliveryFailed({
          current: state,
          failureReason: admission.reason,
        }),
      );
    }
    return repairThenCommit(options, state, observation);
  }
  throw new DeliveryError(
    "ci_timeout",
    "Timed out waiting for current-head CI.",
  );
}

async function repairThenCommit(
  options: DeliveryRunOptions & {
    lease: WorkflowLease;
    nowMs: () => number;
    config: HarnessConfig;
    git: DeliveryGit;
    baseline: FileSnapshot;
    tracer: Tracer;
    workspaceRoot: string;
  },
  state: DeliveryState,
  observation: CiObservation,
): Promise<DeliveryState> {
  state = persist(options, admitCiRepairStarted({ current: state }));
  await repairFromCiEvidence({
    config: options.config,
    spec: state.spec,
    observation,
    workspaceRoot: options.workspaceRoot,
    tracer: options.tracer,
    repair: options.repair,
  });
  await acceptDeliveryCandidate({
    config: options.config,
    spec: state.spec,
    baseline: options.baseline,
    tracer: options.tracer,
    verify: options.verify,
    review: options.review,
  });
  const sha = options.git.commitAcceptedTree(
    options.workspaceRoot,
    `CI repair for ${state.workflowId}`,
  );
  return persist(
    options,
    admitHeadCommitted({ current: state, expectedHeadSha: sha }),
  );
}

async function observeCurrentHeadCi(
  options: { github: GitHubClient },
  state: DeliveryState,
): Promise<CiObservation | null> {
  const expected = state.expectedHeadSha;
  const prNumber = state.prNumber;
  if (!expected || prNumber === undefined) {
    throw new DeliveryError(
      "illegal_transition",
      "CI observation requires expectedHeadSha and prNumber.",
    );
  }
  const runs = (await options.github.listWorkflowRuns(expected)).filter(
    (run) => run.headSha === expected,
  );
  if (runs.length === 0) {
    return null;
  }
  const run = runs.find((item) => item.name === "CI") ?? runs[0];
  if (run.status !== "completed" || !run.conclusion) {
    return null;
  }
  const jobs = await options.github.listJobs(run.id);
  const failedJob =
    jobs.find((job) => job.conclusion === "failure") ?? jobs[0] ?? null;
  const failedStep =
    failedJob?.steps.find((step) => step.conclusion === "failure")?.name ??
    null;
  const excerpt = failedJob
    ? truncateEvidence(await options.github.getJobLogExcerpt(failedJob.id))
    : "";
  const conclusion = asCiConclusion(run.conclusion);
  const failureClass = classifyCiEvidence({
    expectedHeadSha: expected,
    headSha: run.headSha,
    conclusion,
    evidenceExcerpt: excerpt,
  });
  return {
    repository: state.repository,
    prNumber,
    headSha: run.headSha,
    workflow: run.name,
    job: failedJob?.name ?? null,
    failedStep,
    conclusion,
    failureClass,
    evidenceExcerpt: redactSecrets(excerpt),
  };
}

function persist(
  options: { storeDir: string; lease: WorkflowLease; nowMs: () => number },
  state: DeliveryState,
): DeliveryState {
  saveDeliveryStateOwned({
    storeDir: options.storeDir,
    state,
    lease: options.lease,
    now: options.nowMs(),
  });
  return state;
}

function assertOwnership(options: {
  storeDir: string;
  lease: WorkflowLease;
  nowMs: () => number;
}): void {
  const current = loadWorkflowLeaseRecord(
    options.storeDir,
    options.lease.workflowId,
  );
  const owned = assertCurrentOwner({
    current,
    lease: options.lease,
    now: options.nowMs(),
  });
  if (!owned.ok) {
    throw new DeliveryError(
      "not_owner",
      `Privileged GitHub/git write rejected: ${owned.code}.`,
    );
  }
}

function deliveryCommitMessage(state: DeliveryState): string {
  return `Implement issue #${state.issueNumber} (${state.workflowId})`;
}

function asCiConclusion(value: string): CiConclusion {
  if (
    value === "success" ||
    value === "failure" ||
    value === "cancelled" ||
    value === "skipped" ||
    value === "startup_failure" ||
    value === "timed_out" ||
    value === "action_required" ||
    value === "neutral" ||
    value === "stale"
  ) {
    return value;
  }
  return "failure";
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function requireTerminalSuccess(
  workflowId: string,
  storeDir: string,
): TerminalState {
  const workflow = loadWorkflowState(storeDir, workflowId);
  if (workflow.phase !== "terminal") {
    throw new DeliveryError(
      "illegal_transition",
      `Expected terminal workflow, got ${workflow.phase}.`,
    );
  }
  if (workflow.outcome.workflowStatus !== "success") {
    throw new DeliveryError(
      "illegal_transition",
      "Expected successful terminal workflow.",
    );
  }
  return workflow;
}
