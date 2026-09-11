import type { InspectedPaths } from "./context.ts";
import { parseSpec, type Spec, type SpecDecision } from "./spec.ts";
import type { WorkspaceResumeEvidence } from "./workspace.ts";
import { WorkflowError } from "./workflow-error.ts";

export const WORKFLOW_STATE_SCHEMA_VERSION = 1;

export type WorkflowPhase = "spec_required" | "implementation_ready" | "terminal";

export type DurableWorkspace = WorkspaceResumeEvidence;

export type TerminalOutcome = {
  workflowStatus: "success" | "failure" | "needs_human_judgment";
  failureReason?: string;
};

type WorkflowIdentity = {
  schemaVersion: typeof WORKFLOW_STATE_SCHEMA_VERSION;
  workflowId: string;
  task: string;
  workspace: DurableWorkspace;
  createdAt: string;
  updatedAt: string;
};

export type SpecRequiredState = WorkflowIdentity & {
  phase: "spec_required";
};

export type ImplementationReadyState = WorkflowIdentity & {
  phase: "implementation_ready";
  spec: Spec;
  specInspectedPaths: InspectedPaths;
  contextMode: "baseline" | "variant";
};

export type TerminalState = WorkflowIdentity & {
  phase: "terminal";
  outcome: TerminalOutcome;
};

export type WorkflowState =
  | SpecRequiredState
  | ImplementationReadyState
  | TerminalState;

export type DurableAction =
  | "run_spec"
  | "continue_implementation"
  | "reject_terminal";

export function createSpecRequiredState(options: {
  workflowId: string;
  task: string;
  workspace: DurableWorkspace;
  now?: string;
}): SpecRequiredState {
  const createdAt = options.now ?? nowIso();
  return {
    schemaVersion: WORKFLOW_STATE_SCHEMA_VERSION,
    workflowId: options.workflowId,
    task: options.task,
    workspace: options.workspace,
    createdAt,
    updatedAt: createdAt,
    phase: "spec_required",
  };
}

export function admitImplementationReady(options: {
  current: WorkflowState;
  decision: Extract<SpecDecision, { status: "executable" }>;
  specInspectedPaths: InspectedPaths;
  contextMode: "baseline" | "variant";
  now?: string;
}): ImplementationReadyState {
  const { current, decision } = options;
  if (current.phase !== "spec_required") {
    throw new WorkflowError(
      "illegal_transition",
      `Cannot admit implementation_ready from phase ${current.phase}.`,
    );
  }
  if (decision.status !== "executable") {
    throw new WorkflowError(
      "illegal_transition",
      "implementation_ready requires a harness-admitted executable Spec.",
    );
  }

  return {
    schemaVersion: WORKFLOW_STATE_SCHEMA_VERSION,
    workflowId: current.workflowId,
    task: current.task,
    workspace: current.workspace,
    createdAt: current.createdAt,
    updatedAt: options.now ?? nowIso(),
    phase: "implementation_ready",
    spec: decision.spec,
    specInspectedPaths: cloneInspectedPaths(options.specInspectedPaths),
    contextMode: options.contextMode,
  };
}

export function admitTerminal(options: {
  current: WorkflowState;
  outcome: TerminalOutcome;
  now?: string;
}): TerminalState {
  const { current, outcome } = options;
  if (current.phase === "terminal") {
    throw new WorkflowError(
      "illegal_transition",
      "Cannot admit another transition from terminal workflow state.",
    );
  }
  if (
    outcome.workflowStatus !== "success" &&
    outcome.workflowStatus !== "failure" &&
    outcome.workflowStatus !== "needs_human_judgment"
  ) {
    throw new WorkflowError(
      "illegal_transition",
      `Illegal terminal workflowStatus: ${String(outcome.workflowStatus)}.`,
    );
  }

  return {
    schemaVersion: WORKFLOW_STATE_SCHEMA_VERSION,
    workflowId: current.workflowId,
    task: current.task,
    workspace: current.workspace,
    createdAt: current.createdAt,
    updatedAt: options.now ?? nowIso(),
    phase: "terminal",
    outcome: {
      workflowStatus: outcome.workflowStatus,
      ...(outcome.failureReason
        ? { failureReason: outcome.failureReason }
        : {}),
    },
  };
}

export function nextDurableAction(state: WorkflowState): DurableAction {
  if (state.phase === "spec_required") {
    return "run_spec";
  }
  if (state.phase === "implementation_ready") {
    return "continue_implementation";
  }
  return "reject_terminal";
}

export function parseWorkflowState(
  value: unknown,
): { ok: true; value: WorkflowState } | { ok: false; error: string; code: WorkflowError["code"] } {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: "WorkflowState must be an object.",
      code: "corrupt_state",
    };
  }

  if (value.schemaVersion !== WORKFLOW_STATE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported WorkflowState schemaVersion: ${String(value.schemaVersion)}.`,
      code: "unsupported_schema",
    };
  }

  const workflowId = parseNonEmptyString(value.workflowId, "workflowId");
  if (!workflowId.ok) {
    return { ok: false, error: workflowId.error, code: "corrupt_state" };
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
  const workspace = parseDurableWorkspace(value.workspace);
  if (!workspace.ok) {
    return workspace;
  }

  const identity: WorkflowIdentity = {
    schemaVersion: WORKFLOW_STATE_SCHEMA_VERSION,
    workflowId: workflowId.value,
    task: task.value,
    workspace: workspace.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
  };

  if (value.phase === "spec_required") {
    return { ok: true, value: { ...identity, phase: "spec_required" } };
  }

  if (value.phase === "implementation_ready") {
    const spec = parseSpec(value.spec);
    if (!spec.ok) {
      return { ok: false, error: spec.error, code: "corrupt_state" };
    }
    const specInspectedPaths = parseInspectedPaths(value.specInspectedPaths);
    if (!specInspectedPaths.ok) {
      return specInspectedPaths;
    }
    const contextMode = value.contextMode;
    if (contextMode !== "baseline" && contextMode !== "variant") {
      return {
        ok: false,
        error: 'implementation_ready.contextMode must be "baseline" or "variant".',
        code: "corrupt_state",
      };
    }
    return {
      ok: true,
      value: {
        ...identity,
        phase: "implementation_ready",
        spec: spec.value,
        specInspectedPaths: specInspectedPaths.value,
        contextMode,
      },
    };
  }

  if (value.phase === "terminal") {
    const outcome = parseTerminalOutcome(value.outcome);
    if (!outcome.ok) {
      return outcome;
    }
    return {
      ok: true,
      value: {
        ...identity,
        phase: "terminal",
        outcome: outcome.value,
      },
    };
  }

  return {
    ok: false,
    error: `Unsupported WorkflowState phase: ${String(value.phase)}.`,
    code: "unsupported_phase",
  };
}

function parseDurableWorkspace(
  value: unknown,
): { ok: true; value: DurableWorkspace } | { ok: false; error: string; code: WorkflowError["code"] } {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: "workspace must be an object.",
      code: "corrupt_state",
    };
  }
  const id = parseNonEmptyString(value.id, "workspace.id");
  if (!id.ok) return { ok: false, error: id.error, code: "corrupt_state" };
  const root = parseNonEmptyString(value.root, "workspace.root");
  if (!root.ok) return { ok: false, error: root.error, code: "corrupt_state" };
  const baseRevision = parseNonEmptyString(
    value.baseRevision,
    "workspace.baseRevision",
  );
  if (!baseRevision.ok) {
    return { ok: false, error: baseRevision.error, code: "corrupt_state" };
  }
  const ref = parseNonEmptyString(value.ref, "workspace.ref");
  if (!ref.ok) return { ok: false, error: ref.error, code: "corrupt_state" };
  const headRevision = parseNonEmptyString(
    value.headRevision,
    "workspace.headRevision",
  );
  if (!headRevision.ok) {
    return { ok: false, error: headRevision.error, code: "corrupt_state" };
  }
  const workingTreeFingerprint = parseNonEmptyString(
    value.workingTreeFingerprint,
    "workspace.workingTreeFingerprint",
  );
  if (!workingTreeFingerprint.ok) {
    return {
      ok: false,
      error: workingTreeFingerprint.error,
      code: "corrupt_state",
    };
  }
  return {
    ok: true,
    value: {
      id: id.value,
      root: root.value,
      baseRevision: baseRevision.value,
      ref: ref.value,
      headRevision: headRevision.value,
      workingTreeFingerprint: workingTreeFingerprint.value,
    },
  };
}

function parseInspectedPaths(
  value: unknown,
): { ok: true; value: InspectedPaths } | { ok: false; error: string; code: WorkflowError["code"] } {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: "specInspectedPaths must be an object.",
      code: "corrupt_state",
    };
  }
  const readFiles = parseStringArray(value.readFiles, "specInspectedPaths.readFiles");
  if (!readFiles.ok) {
    return { ok: false, error: readFiles.error, code: "corrupt_state" };
  }
  const listedPaths = parseStringArray(
    value.listedPaths,
    "specInspectedPaths.listedPaths",
  );
  if (!listedPaths.ok) {
    return { ok: false, error: listedPaths.error, code: "corrupt_state" };
  }
  return {
    ok: true,
    value: { readFiles: readFiles.value, listedPaths: listedPaths.value },
  };
}

function parseTerminalOutcome(
  value: unknown,
): { ok: true; value: TerminalOutcome } | { ok: false; error: string; code: WorkflowError["code"] } {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: "terminal.outcome must be an object.",
      code: "corrupt_state",
    };
  }
  const workflowStatus = value.workflowStatus;
  if (
    workflowStatus !== "success" &&
    workflowStatus !== "failure" &&
    workflowStatus !== "needs_human_judgment"
  ) {
    return {
      ok: false,
      error: "terminal.outcome.workflowStatus is invalid.",
      code: "corrupt_state",
    };
  }
  const failureReason = value.failureReason;
  if (failureReason !== undefined && typeof failureReason !== "string") {
    return {
      ok: false,
      error: "terminal.outcome.failureReason must be a string when present.",
      code: "corrupt_state",
    };
  }
  return {
    ok: true,
    value: {
      workflowStatus,
      ...(typeof failureReason === "string" ? { failureReason } : {}),
    },
  };
}

function parseStringArray(
  value: unknown,
  field: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return { ok: false, error: `${field} must be an array of strings.` };
  }
  return { ok: true, value };
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

function cloneInspectedPaths(paths: InspectedPaths): InspectedPaths {
  return {
    readFiles: [...paths.readFiles],
    listedPaths: [...paths.listedPaths],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
