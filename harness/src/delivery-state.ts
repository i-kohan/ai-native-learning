import { parseSpec, type Spec } from "./spec.ts";
import { sanitizeWorkflowId } from "./workflow-id.ts";
import type { DurableWorkspace, ReviewBaselineRef } from "./workflow-state.ts";
import { DeliveryError } from "./delivery-error.ts";

export const DELIVERY_STATE_SCHEMA_VERSION = 1;
export const MAX_CI_REPAIR_ATTEMPTS = 1;

export const DELIVERY_PHASES = [
  "local_accepted",
  "head_committed",
  "branch_reconciled",
  "pr_reconciled",
  "ci_waiting",
  "ready_for_human_review",
  "delivery_failed",
] as const;

export type DeliveryPhase = (typeof DELIVERY_PHASES)[number];

export type CiFailureClass = "semantic" | "infrastructure" | "policy" | "stale";

export type CiConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "startup_failure"
  | "timed_out"
  | "action_required"
  | "neutral"
  | "stale";

export type CiObservation = {
  repository: string;
  prNumber: number;
  headSha: string;
  workflow: string;
  job: string | null;
  failedStep: string | null;
  conclusion: CiConclusion;
  failureClass: CiFailureClass | "success";
  evidenceExcerpt: string;
};

export type DeliveryState = {
  schemaVersion: typeof DELIVERY_STATE_SCHEMA_VERSION;
  workflowId: string;
  repository: string;
  issueNumber: number;
  issueUrl: string;
  defaultBranch: string;
  baseSha: string;
  branch: string;
  prNumber?: number;
  expectedHeadSha?: string;
  firstHeadSha?: string;
  publishedHeadSha?: string;
  deliveryPhase: DeliveryPhase;
  ciObservation?: CiObservation;
  ciRepairAttempts: number;
  spec: Spec;
  reviewBaseline: ReviewBaselineRef;
  workspace: DurableWorkspace;
  task: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
};

export function deliveryBranchFor(workflowId: string): string {
  return `agent/${sanitizeWorkflowId(workflowId)}`;
}

export function assertSafeDeliveryBranch(
  branch: string,
  defaultBranch: string,
): void {
  const name = stripRefsHeads(branch);
  const protectedNames = new Set(
    ["main", "master", stripRefsHeads(defaultBranch)].filter(Boolean),
  );
  if (protectedNames.has(name)) {
    throw new DeliveryError(
      "protected_branch",
      `Delivery must not target the default/protected branch ${name}.`,
    );
  }
  if (!name.startsWith("agent/")) {
    throw new DeliveryError(
      "protected_branch",
      `Delivery branch must be agent/<workflowId>, got ${name}.`,
    );
  }
}

export function createLocalAcceptedDelivery(options: {
  workflowId: string;
  repository: string;
  issueNumber: number;
  issueUrl: string;
  defaultBranch: string;
  baseSha: string;
  spec: Spec;
  reviewBaseline: ReviewBaselineRef;
  workspace: DurableWorkspace;
  task: string;
  now?: string;
}): DeliveryState {
  const branch = deliveryBranchFor(options.workflowId);
  assertSafeDeliveryBranch(branch, options.defaultBranch);
  if (options.baseSha !== options.workspace.baseRevision) {
    throw new DeliveryError(
      "illegal_transition",
      "Delivery baseSha must equal the validated workspace baseRevision.",
    );
  }
  const createdAt = options.now ?? nowIso();
  return {
    schemaVersion: DELIVERY_STATE_SCHEMA_VERSION,
    workflowId: options.workflowId,
    repository: options.repository,
    issueNumber: options.issueNumber,
    issueUrl: options.issueUrl,
    defaultBranch: options.defaultBranch,
    baseSha: options.baseSha,
    branch,
    deliveryPhase: "local_accepted",
    ciRepairAttempts: 0,
    spec: options.spec,
    reviewBaseline: options.reviewBaseline,
    workspace: options.workspace,
    task: options.task,
    createdAt,
    updatedAt: createdAt,
  };
}

export function admitHeadCommitted(options: {
  current: DeliveryState;
  expectedHeadSha: string;
  now?: string;
}): DeliveryState {
  const { current } = options;
  if (
    current.deliveryPhase !== "local_accepted" &&
    current.deliveryPhase !== "ci_waiting"
  ) {
    throw new DeliveryError(
      "illegal_transition",
      `Cannot admit head_committed from ${current.deliveryPhase}.`,
    );
  }
  if (current.deliveryPhase === "ci_waiting" && current.ciRepairAttempts < 1) {
    throw new DeliveryError(
      "illegal_transition",
      "A new delivery head after CI requires the bounded repair attempt to be counted first.",
    );
  }
  const sha = parseSha(options.expectedHeadSha, "expectedHeadSha");
  if (current.expectedHeadSha && sha === current.expectedHeadSha) {
    throw new DeliveryError(
      "illegal_transition",
      "Repaired head must differ from the previous expectedHeadSha.",
    );
  }
  if (sha === current.baseSha) {
    throw new DeliveryError(
      "illegal_transition",
      "expectedHeadSha must be a new commit, not the delivery baseSha.",
    );
  }
  return persistShape(current, {
    deliveryPhase: "head_committed",
    expectedHeadSha: sha,
    firstHeadSha: current.firstHeadSha ?? sha,
    updatedAt: options.now ?? nowIso(),
  });
}

export function admitBranchReconciled(options: {
  current: DeliveryState;
  publishedHeadSha: string;
  now?: string;
}): DeliveryState {
  const { current } = options;
  if (
    current.deliveryPhase !== "head_committed" &&
    current.deliveryPhase !== "branch_reconciled"
  ) {
    throw new DeliveryError(
      "illegal_transition",
      `Cannot admit branch_reconciled from ${current.deliveryPhase}.`,
    );
  }
  const expected = requireExpectedHead(current);
  const published = parseSha(options.publishedHeadSha, "publishedHeadSha");
  if (published !== expected) {
    throw new DeliveryError(
      "unexpected_remote_head",
      "Remote branch may advance only when it equals expectedHeadSha.",
    );
  }
  return persistShape(current, {
    deliveryPhase: "branch_reconciled",
    publishedHeadSha: published,
    updatedAt: options.now ?? nowIso(),
  });
}

export function admitPrReconciled(options: {
  current: DeliveryState;
  prNumber: number;
  now?: string;
}): DeliveryState {
  const { current } = options;
  if (
    current.deliveryPhase !== "branch_reconciled" &&
    current.deliveryPhase !== "pr_reconciled"
  ) {
    throw new DeliveryError(
      "illegal_transition",
      `Cannot admit pr_reconciled from ${current.deliveryPhase}.`,
    );
  }
  if (!Number.isInteger(options.prNumber) || options.prNumber <= 0) {
    throw new DeliveryError("illegal_transition", "prNumber must be >= 1.");
  }
  if (current.prNumber !== undefined && current.prNumber !== options.prNumber) {
    throw new DeliveryError(
      "illegal_transition",
      `Delivery already owns PR ${current.prNumber}; refusing PR ${options.prNumber}.`,
    );
  }
  return persistShape(current, {
    deliveryPhase: "pr_reconciled",
    prNumber: options.prNumber,
    updatedAt: options.now ?? nowIso(),
  });
}

export function admitCiWaiting(options: {
  current: DeliveryState;
  now?: string;
}): DeliveryState {
  const { current } = options;
  if (
    current.deliveryPhase !== "pr_reconciled" &&
    current.deliveryPhase !== "ci_waiting"
  ) {
    throw new DeliveryError(
      "illegal_transition",
      `Cannot admit ci_waiting from ${current.deliveryPhase}.`,
    );
  }
  requireExpectedHead(current);
  if (current.prNumber === undefined) {
    throw new DeliveryError(
      "illegal_transition",
      "ci_waiting requires a reconciled PR number.",
    );
  }
  return persistShape(current, {
    deliveryPhase: "ci_waiting",
    updatedAt: options.now ?? nowIso(),
  });
}

export function admitCiObservation(options: {
  current: DeliveryState;
  observation: CiObservation;
  now?: string;
}): DeliveryState {
  const { current } = options;
  if (current.deliveryPhase !== "ci_waiting") {
    throw new DeliveryError(
      "illegal_transition",
      `Cannot persist CI observation from ${current.deliveryPhase}.`,
    );
  }
  const parsed = parseCiObservation(options.observation);
  if (!parsed.ok) {
    throw new DeliveryError("corrupt_state", parsed.error);
  }
  return persistShape(current, {
    ciObservation: parsed.value,
    updatedAt: options.now ?? nowIso(),
  });
}

export function admitReadyForHumanReview(options: {
  current: DeliveryState;
  observation: CiObservation;
  now?: string;
}): DeliveryState {
  const { current } = options;
  if (current.deliveryPhase !== "ci_waiting") {
    throw new DeliveryError(
      "illegal_transition",
      `Cannot admit ready_for_human_review from ${current.deliveryPhase}.`,
    );
  }
  const expected = requireExpectedHead(current);
  const parsed = parseCiObservation(options.observation);
  if (!parsed.ok) {
    throw new DeliveryError("corrupt_state", parsed.error);
  }
  if (parsed.value.headSha !== expected) {
    throw new DeliveryError(
      "stale_ci_evidence",
      "CI success for a SHA other than expectedHeadSha cannot authorize delivery.",
    );
  }
  if (
    parsed.value.conclusion !== "success" ||
    parsed.value.failureClass !== "success"
  ) {
    throw new DeliveryError(
      "illegal_transition",
      "ready_for_human_review requires current-head CI success.",
    );
  }
  return persistShape(current, {
    deliveryPhase: "ready_for_human_review",
    ciObservation: parsed.value,
    updatedAt: options.now ?? nowIso(),
  });
}

export function admitCiRepairStarted(options: {
  current: DeliveryState;
  now?: string;
}): DeliveryState {
  const { current } = options;
  if (current.deliveryPhase !== "ci_waiting") {
    throw new DeliveryError(
      "illegal_transition",
      `Cannot start CI repair from ${current.deliveryPhase}.`,
    );
  }
  if (current.ciRepairAttempts >= MAX_CI_REPAIR_ATTEMPTS) {
    throw new DeliveryError(
      "illegal_transition",
      "Only one CI repair attempt is allowed.",
    );
  }
  const observation = current.ciObservation;
  if (!observation || observation.failureClass !== "semantic") {
    throw new DeliveryError(
      "illegal_transition",
      "CI repair requires a current-head semantic failure observation.",
    );
  }
  if (observation.headSha !== requireExpectedHead(current)) {
    throw new DeliveryError(
      "stale_ci_evidence",
      "CI repair must be derived from current expectedHeadSha evidence.",
    );
  }
  return persistShape(current, {
    ciRepairAttempts: current.ciRepairAttempts + 1,
    updatedAt: options.now ?? nowIso(),
  });
}

export function admitDeliveryFailed(options: {
  current: DeliveryState;
  failureReason: string;
  now?: string;
}): DeliveryState {
  const { current } = options;
  if (
    current.deliveryPhase === "ready_for_human_review" ||
    current.deliveryPhase === "delivery_failed"
  ) {
    throw new DeliveryError(
      "illegal_transition",
      `Cannot fail a ${current.deliveryPhase} delivery.`,
    );
  }
  return persistShape(current, {
    deliveryPhase: "delivery_failed",
    failureReason: options.failureReason,
    updatedAt: options.now ?? nowIso(),
  });
}

export function parseDeliveryState(
  value: unknown,
):
  | { ok: true; value: DeliveryState }
  | { ok: false; error: string; code: DeliveryError["code"] } {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: "DeliveryState must be an object.",
      code: "corrupt_state",
    };
  }
  if (value.schemaVersion !== DELIVERY_STATE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported DeliveryState schemaVersion: ${String(value.schemaVersion)}.`,
      code: "unsupported_schema",
    };
  }
  const workflowId = parseNonEmptyString(value.workflowId, "workflowId");
  if (!workflowId.ok) {
    return { ok: false, error: workflowId.error, code: "corrupt_state" };
  }
  const repository = parseNonEmptyString(value.repository, "repository");
  if (!repository.ok) {
    return { ok: false, error: repository.error, code: "corrupt_state" };
  }
  const issueNumber = parseIntegerInRange(value.issueNumber, "issueNumber", 1);
  if (!issueNumber.ok) {
    return { ok: false, error: issueNumber.error, code: "corrupt_state" };
  }
  const issueUrl = parseNonEmptyString(value.issueUrl, "issueUrl");
  if (!issueUrl.ok) {
    return { ok: false, error: issueUrl.error, code: "corrupt_state" };
  }
  const defaultBranch = parseNonEmptyString(
    value.defaultBranch,
    "defaultBranch",
  );
  if (!defaultBranch.ok) {
    return { ok: false, error: defaultBranch.error, code: "corrupt_state" };
  }
  const baseSha = parseOptionalSha(value.baseSha, "baseSha");
  if (!baseSha.ok) {
    return { ok: false, error: baseSha.error, code: "corrupt_state" };
  }
  const branch = parseNonEmptyString(value.branch, "branch");
  if (!branch.ok) {
    return { ok: false, error: branch.error, code: "corrupt_state" };
  }
  try {
    assertSafeDeliveryBranch(branch.value, defaultBranch.value);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: "protected_branch",
    };
  }
  const phase = value.deliveryPhase;
  if (!isDeliveryPhase(phase)) {
    return {
      ok: false,
      error: `Unsupported deliveryPhase: ${String(phase)}.`,
      code: "unsupported_phase",
    };
  }
  const ciRepairAttempts = parseIntegerInRange(
    value.ciRepairAttempts,
    "ciRepairAttempts",
    0,
    MAX_CI_REPAIR_ATTEMPTS,
  );
  if (!ciRepairAttempts.ok) {
    return { ok: false, error: ciRepairAttempts.error, code: "corrupt_state" };
  }
  const spec = parseSpec(value.spec);
  if (!spec.ok) {
    return { ok: false, error: spec.error, code: "corrupt_state" };
  }
  const reviewBaseline = parseReviewBaseline(value.reviewBaseline);
  if (!reviewBaseline.ok) {
    return { ok: false, error: reviewBaseline.error, code: "corrupt_state" };
  }
  const workspace = parseWorkspace(value.workspace);
  if (!workspace.ok) {
    return { ok: false, error: workspace.error, code: "corrupt_state" };
  }
  const task = parseNonEmptyString(value.task, "task");
  if (!task.ok) {
    return { ok: false, error: task.error, code: "corrupt_state" };
  }
  const createdAt = parseNonEmptyString(value.createdAt, "createdAt");
  if (!createdAt.ok) {
    return { ok: false, error: createdAt.error, code: "corrupt_state" };
  }
  const updatedAt = parseNonEmptyString(value.updatedAt, "updatedAt");
  if (!updatedAt.ok) {
    return { ok: false, error: updatedAt.error, code: "corrupt_state" };
  }

  let expectedHeadSha: string | undefined;
  if (value.expectedHeadSha !== undefined) {
    const parsed = parseOptionalSha(value.expectedHeadSha, "expectedHeadSha");
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, code: "corrupt_state" };
    }
    expectedHeadSha = parsed.value;
  }
  let firstHeadSha: string | undefined;
  if (value.firstHeadSha !== undefined) {
    const parsed = parseOptionalSha(value.firstHeadSha, "firstHeadSha");
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, code: "corrupt_state" };
    }
    firstHeadSha = parsed.value;
  }
  let publishedHeadSha: string | undefined;
  if (value.publishedHeadSha !== undefined) {
    const parsed = parseOptionalSha(value.publishedHeadSha, "publishedHeadSha");
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, code: "corrupt_state" };
    }
    publishedHeadSha = parsed.value;
  }
  if (
    phase !== "local_accepted" &&
    phase !== "delivery_failed" &&
    !expectedHeadSha
  ) {
    return {
      ok: false,
      error: `${phase} requires expectedHeadSha.`,
      code: "corrupt_state",
    };
  }
  let prNumber: number | undefined;
  if (value.prNumber !== undefined) {
    const parsed = parseIntegerInRange(value.prNumber, "prNumber", 1);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, code: "corrupt_state" };
    }
    prNumber = parsed.value;
  }
  if (
    (phase === "pr_reconciled" ||
      phase === "ci_waiting" ||
      phase === "ready_for_human_review") &&
    prNumber === undefined
  ) {
    return {
      ok: false,
      error: `${phase} requires prNumber.`,
      code: "corrupt_state",
    };
  }
  let ciObservation: CiObservation | undefined;
  if (value.ciObservation !== undefined) {
    const parsed = parseCiObservation(value.ciObservation);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, code: "corrupt_state" };
    }
    ciObservation = parsed.value;
  }
  const failureReason = value.failureReason;
  if (failureReason !== undefined && typeof failureReason !== "string") {
    return {
      ok: false,
      error: "failureReason must be a string when present.",
      code: "corrupt_state",
    };
  }

  return {
    ok: true,
    value: {
      schemaVersion: DELIVERY_STATE_SCHEMA_VERSION,
      workflowId: workflowId.value,
      repository: repository.value,
      issueNumber: issueNumber.value,
      issueUrl: issueUrl.value,
      defaultBranch: defaultBranch.value,
      baseSha: baseSha.value,
      branch: branch.value,
      deliveryPhase: phase,
      ciRepairAttempts: ciRepairAttempts.value,
      spec: spec.value,
      reviewBaseline: reviewBaseline.value,
      workspace: workspace.value,
      task: task.value,
      createdAt: createdAt.value,
      updatedAt: updatedAt.value,
      ...(expectedHeadSha ? { expectedHeadSha } : {}),
      ...(firstHeadSha ? { firstHeadSha } : {}),
      ...(publishedHeadSha ? { publishedHeadSha } : {}),
      ...(prNumber !== undefined ? { prNumber } : {}),
      ...(ciObservation ? { ciObservation } : {}),
      ...(typeof failureReason === "string" ? { failureReason } : {}),
    },
  };
}

function persistShape(
  current: DeliveryState,
  patch: Partial<DeliveryState>,
): DeliveryState {
  const next = { ...current, ...patch };
  const parsed = parseDeliveryState(next);
  if (!parsed.ok) {
    throw new DeliveryError(parsed.code, parsed.error);
  }
  return parsed.value;
}

function requireExpectedHead(state: DeliveryState): string {
  if (!state.expectedHeadSha) {
    throw new DeliveryError(
      "illegal_transition",
      "expectedHeadSha is required after the first locally accepted commit.",
    );
  }
  return state.expectedHeadSha;
}

function parseCiObservation(
  value: unknown,
): { ok: true; value: CiObservation } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "ciObservation must be an object." };
  }
  const repository = parseNonEmptyString(
    value.repository,
    "ciObservation.repository",
  );
  if (!repository.ok) return repository;
  const prNumber = parseIntegerInRange(
    value.prNumber,
    "ciObservation.prNumber",
    1,
  );
  if (!prNumber.ok) return prNumber;
  const headSha = parseOptionalSha(value.headSha, "ciObservation.headSha");
  if (!headSha.ok) return headSha;
  const workflow = parseNonEmptyString(
    value.workflow,
    "ciObservation.workflow",
  );
  if (!workflow.ok) return workflow;
  const job = parseNullableString(value.job, "ciObservation.job");
  if (!job.ok) return job;
  const failedStep = parseNullableString(
    value.failedStep,
    "ciObservation.failedStep",
  );
  if (!failedStep.ok) return failedStep;
  if (!isCiConclusion(value.conclusion)) {
    return {
      ok: false,
      error: `Unsupported CI conclusion: ${String(value.conclusion)}.`,
    };
  }
  if (!isFailureClass(value.failureClass)) {
    return {
      ok: false,
      error: `Unsupported CI failureClass: ${String(value.failureClass)}.`,
    };
  }
  if (typeof value.evidenceExcerpt !== "string") {
    return {
      ok: false,
      error: "ciObservation.evidenceExcerpt must be a string.",
    };
  }
  return {
    ok: true,
    value: {
      repository: repository.value,
      prNumber: prNumber.value,
      headSha: headSha.value,
      workflow: workflow.value,
      job: job.value,
      failedStep: failedStep.value,
      conclusion: value.conclusion,
      failureClass: value.failureClass,
      evidenceExcerpt: value.evidenceExcerpt,
    },
  };
}

function parseReviewBaseline(
  value: unknown,
): { ok: true; value: ReviewBaselineRef } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "reviewBaseline must be an object." };
  }
  const artifactId = parseNonEmptyString(
    value.artifactId,
    "reviewBaseline.artifactId",
  );
  if (!artifactId.ok) return artifactId;
  const fingerprint = parseNonEmptyString(
    value.fingerprint,
    "reviewBaseline.fingerprint",
  );
  if (!fingerprint.ok) return fingerprint;
  return {
    ok: true,
    value: { artifactId: artifactId.value, fingerprint: fingerprint.value },
  };
}

function parseWorkspace(
  value: unknown,
): { ok: true; value: DurableWorkspace } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "workspace must be an object." };
  }
  const fields = [
    "id",
    "root",
    "baseRevision",
    "ref",
    "headRevision",
    "workingTreeFingerprint",
  ] as const;
  const parsed: Partial<DurableWorkspace> = {};
  for (const field of fields) {
    const item = parseNonEmptyString(value[field], `workspace.${field}`);
    if (!item.ok) return item;
    parsed[field] = item.value;
  }
  return { ok: true, value: parsed as DurableWorkspace };
}

function parseIntegerInRange(
  value: unknown,
  field: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { ok: false, error: `${field} must be an integer.` };
  }
  if (value < min || value > max) {
    return { ok: false, error: `${field} must be an integer ${min}..${max}.` };
  }
  return { ok: true, value };
}

function parseOptionalSha(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value)) {
    return { ok: false, error: `${field} must be a 40-character SHA.` };
  }
  return { ok: true, value: value.toLowerCase() };
}

function parseSha(value: string, field: string): string {
  const parsed = parseOptionalSha(value, field);
  if (!parsed.ok) {
    throw new DeliveryError("illegal_transition", parsed.error);
  }
  return parsed.value;
}

function parseNullableString(
  value: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) {
    return { ok: true, value: null };
  }
  return parseNonEmptyString(value, field);
}

function parseNonEmptyString(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: `${field} must be a non-empty string.` };
  }
  return { ok: true, value };
}

function isDeliveryPhase(value: unknown): value is DeliveryPhase {
  return (
    typeof value === "string" &&
    (DELIVERY_PHASES as readonly string[]).includes(value)
  );
}

function isCiConclusion(value: unknown): value is CiConclusion {
  return (
    value === "success" ||
    value === "failure" ||
    value === "cancelled" ||
    value === "skipped" ||
    value === "startup_failure" ||
    value === "timed_out" ||
    value === "action_required" ||
    value === "neutral" ||
    value === "stale"
  );
}

function isFailureClass(
  value: unknown,
): value is CiObservation["failureClass"] {
  return (
    value === "success" ||
    value === "semantic" ||
    value === "infrastructure" ||
    value === "policy" ||
    value === "stale"
  );
}

function stripRefsHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
