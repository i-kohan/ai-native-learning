import fs from "node:fs";
import path from "node:path";
import { sanitizeWorkflowId } from "./workflow-id.ts";
import type { WorkflowLease } from "./workflow-lease.ts";
import {
  assertCurrentOwner,
  readLeaseRecordUnlocked,
} from "./workflow-lease-store.ts";
import { withWorkflowLock } from "./workflow-lock.ts";
import { WorkflowError } from "./workflow-error.ts";
import {
  createSpecRequiredState,
  parseWorkflowState,
  type DurableWorkspace,
  type WorkflowState,
} from "./workflow-state.ts";

export function workflowStatePath(
  storeDir: string,
  workflowId: string,
): string {
  return path.join(storeDir, `${sanitizeWorkflowId(workflowId)}.json`);
}

export function initializeWorkflow(options: {
  storeDir: string;
  workflowId: string;
  task: string;
  workspace: DurableWorkspace;
}): WorkflowState {
  return withWorkflowLock(options.storeDir, options.workflowId, () => {
    const dest = workflowStatePath(options.storeDir, options.workflowId);
    if (fs.existsSync(dest)) {
      throw new WorkflowError(
        "workflow_exists",
        `Workflow state already exists: ${dest}`,
      );
    }
    const state = createSpecRequiredState({
      workflowId: options.workflowId,
      task: options.task,
      workspace: options.workspace,
    });
    replaceWorkflowStateFile(options.storeDir, state);
    return state;
  });
}

export function saveWorkflowStateOwned(options: {
  storeDir: string;
  state: WorkflowState;
  lease: Pick<WorkflowLease, "workflowId" | "ownerId" | "fencingToken">;
  now: number;
}): void {
  const parsed = parseWorkflowState(options.state);
  if (!parsed.ok) {
    throw new WorkflowError(parsed.code, parsed.error);
  }
  if (parsed.value.workflowId !== options.lease.workflowId) {
    throw new WorkflowError(
      "not_owner",
      `Lease workflowId ${options.lease.workflowId} does not match state ${parsed.value.workflowId}.`,
    );
  }
  withWorkflowLock(options.storeDir, parsed.value.workflowId, () => {
    const current = readLeaseRecordUnlocked(
      options.storeDir,
      parsed.value.workflowId,
    );
    const owned = assertCurrentOwner({
      current,
      lease: options.lease,
      now: options.now,
    });
    if (!owned.ok) {
      throw new WorkflowError(
        fencingErrorCode(owned.code),
        `Fenced WorkflowState save rejected: ${owned.code}.`,
      );
    }
    replaceWorkflowStateFile(options.storeDir, parsed.value);
  });
}

/** Fixture/bootstrap only. Durable transitions must use saveWorkflowStateOwned. */
export function saveWorkflowStateUnfenced(
  storeDir: string,
  state: WorkflowState,
): void {
  const parsed = parseWorkflowState(state);
  if (!parsed.ok) {
    throw new WorkflowError(parsed.code, parsed.error);
  }
  withWorkflowLock(storeDir, parsed.value.workflowId, () => {
    replaceWorkflowStateFile(storeDir, parsed.value);
  });
}

export function loadWorkflowState(
  storeDir: string,
  workflowId: string,
): WorkflowState {
  const dest = workflowStatePath(storeDir, workflowId);
  if (!fs.existsSync(dest)) {
    throw new WorkflowError(
      "missing_state",
      `Workflow state is missing: ${dest}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(dest, "utf8"));
  } catch {
    throw new WorkflowError(
      "corrupt_state",
      `Workflow state is not valid JSON: ${dest}`,
    );
  }

  const parsed = parseWorkflowState(raw);
  if (!parsed.ok) {
    throw new WorkflowError(parsed.code, parsed.error);
  }
  if (parsed.value.workflowId !== workflowId) {
    throw new WorkflowError(
      "corrupt_state",
      `Persisted workflowId ${parsed.value.workflowId} does not match requested ${workflowId}.`,
    );
  }
  return parsed.value;
}

function replaceWorkflowStateFile(
  storeDir: string,
  state: WorkflowState,
): void {
  const parsed = parseWorkflowState(state);
  if (!parsed.ok) {
    throw new WorkflowError(parsed.code, parsed.error);
  }
  fs.mkdirSync(storeDir, { recursive: true });
  const dest = workflowStatePath(storeDir, parsed.value.workflowId);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(parsed.value, null, 2)}\n`);
    fs.renameSync(tmp, dest);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best-effort cleanup of a leftover temp file.
    }
    throw error;
  }
}

function fencingErrorCode(
  code: "stale_owner" | "fencing_mismatch" | "lease_expired" | "missing_lease",
): WorkflowError["code"] {
  if (code === "lease_expired") {
    return "lease_expired";
  }
  if (code === "fencing_mismatch") {
    return "stale_fencing_token";
  }
  return "not_owner";
}
