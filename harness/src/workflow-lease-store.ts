import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sanitizeWorkflowId } from "./workflow-id.ts";
import {
  emptyLeaseRecord,
  isLeaseExpired,
  isLeaseHeld,
  isLeaseReleased,
  parseWorkflowLeaseRecord,
  toWorkflowLease,
  type LeaseAcquireResult,
  type LeaseMutationResult,
  type WorkflowLease,
  type WorkflowLeaseRecord,
} from "./workflow-lease.ts";
import { withWorkflowLock } from "./workflow-lock.ts";
import { WorkflowError } from "./workflow-error.ts";

export const DEFAULT_WORKFLOW_LEASE_TTL_MS = 30 * 60 * 1000;

export function workflowLeasePath(
  storeDir: string,
  workflowId: string,
): string {
  return path.join(storeDir, `${sanitizeWorkflowId(workflowId)}.lease.json`);
}

export function createWorkflowOwnerId(): string {
  return `owner-${process.pid}-${randomUUID()}`;
}

export function acquireWorkflowLease(options: {
  storeDir: string;
  workflowId: string;
  ownerId: string;
  ttlMs: number;
  now: number;
}): LeaseAcquireResult {
  assertPositiveTtl(options.ttlMs);
  return withWorkflowLock(options.storeDir, options.workflowId, () => {
    const current = readLeaseRecord(options.storeDir, options.workflowId);
    if (isLeaseHeld(current, options.now)) {
      return { ok: false, code: "lease_held", current };
    }
    const next: WorkflowLeaseRecord = {
      schemaVersion: current.schemaVersion,
      workflowId: options.workflowId,
      ownerId: options.ownerId,
      fencingToken: current.fencingToken + 1,
      expiresAt: options.now + options.ttlMs,
    };
    persistLeaseRecord(options.storeDir, next);
    const lease = toWorkflowLease(next);
    if (!lease) {
      throw new WorkflowError(
        "corrupt_state",
        "Acquired lease must have ownerId and expiresAt.",
      );
    }
    return { ok: true, lease };
  });
}

export function renewWorkflowLease(options: {
  storeDir: string;
  lease: WorkflowLease;
  ttlMs: number;
  now: number;
}): LeaseMutationResult {
  assertPositiveTtl(options.ttlMs);
  return withWorkflowLock(options.storeDir, options.lease.workflowId, () => {
    const current = readLeaseRecord(options.storeDir, options.lease.workflowId);
    const ownership = matchOwnership(current, options.lease);
    if (!ownership.ok) {
      return ownership;
    }
    if (isLeaseExpired(current, options.now) || isLeaseReleased(current)) {
      return { ok: false, code: "lease_expired", current };
    }
    const next: WorkflowLeaseRecord = {
      ...current,
      expiresAt: options.now + options.ttlMs,
    };
    persistLeaseRecord(options.storeDir, next);
    return { ok: true, record: next };
  });
}

export function releaseWorkflowLease(options: {
  storeDir: string;
  lease: WorkflowLease;
}): LeaseMutationResult {
  return withWorkflowLock(options.storeDir, options.lease.workflowId, () => {
    const current = readLeaseRecord(options.storeDir, options.lease.workflowId);
    const ownership = matchOwnership(current, options.lease);
    if (!ownership.ok) {
      return ownership;
    }
    const next: WorkflowLeaseRecord = {
      ...current,
      ownerId: null,
      expiresAt: null,
    };
    persistLeaseRecord(options.storeDir, next);
    return { ok: true, record: next };
  });
}

export function loadWorkflowLeaseRecord(
  storeDir: string,
  workflowId: string,
): WorkflowLeaseRecord {
  return withWorkflowLock(storeDir, workflowId, () =>
    readLeaseRecordUnlocked(storeDir, workflowId),
  );
}

export function readLeaseRecordUnlocked(
  storeDir: string,
  workflowId: string,
): WorkflowLeaseRecord {
  return readLeaseRecord(storeDir, workflowId);
}

export function assertCurrentOwner(options: {
  current: WorkflowLeaseRecord;
  lease: Pick<WorkflowLease, "workflowId" | "ownerId" | "fencingToken">;
  now: number;
}): LeaseMutationResult {
  if (options.current.workflowId !== options.lease.workflowId) {
    return {
      ok: false,
      code: "stale_owner",
      current: options.current,
    };
  }
  const ownership = matchOwnership(options.current, options.lease);
  if (!ownership.ok) {
    return ownership;
  }
  if (
    isLeaseReleased(options.current) ||
    isLeaseExpired(options.current, options.now)
  ) {
    return { ok: false, code: "lease_expired", current: options.current };
  }
  return { ok: true, record: options.current };
}

function matchOwnership(
  current: WorkflowLeaseRecord,
  lease: Pick<WorkflowLease, "workflowId" | "ownerId" | "fencingToken">,
): LeaseMutationResult {
  if (current.ownerId === null) {
    return { ok: false, code: "missing_lease", current };
  }
  if (current.ownerId !== lease.ownerId) {
    return { ok: false, code: "stale_owner", current };
  }
  if (current.fencingToken !== lease.fencingToken) {
    return { ok: false, code: "fencing_mismatch", current };
  }
  return { ok: true, record: current };
}

function readLeaseRecord(
  storeDir: string,
  workflowId: string,
): WorkflowLeaseRecord {
  const dest = workflowLeasePath(storeDir, workflowId);
  if (!fs.existsSync(dest)) {
    return emptyLeaseRecord(workflowId);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(dest, "utf8"));
  } catch {
    throw new WorkflowError(
      "corrupt_state",
      `Workflow lease is not valid JSON: ${dest}`,
    );
  }
  const parsed = parseWorkflowLeaseRecord(raw);
  if (!parsed.ok) {
    throw new WorkflowError("corrupt_state", parsed.error);
  }
  if (parsed.value.workflowId !== workflowId) {
    throw new WorkflowError(
      "corrupt_state",
      `Persisted lease workflowId ${parsed.value.workflowId} does not match requested ${workflowId}.`,
    );
  }
  return parsed.value;
}

function persistLeaseRecord(
  storeDir: string,
  record: WorkflowLeaseRecord,
): void {
  const parsed = parseWorkflowLeaseRecord(record);
  if (!parsed.ok) {
    throw new WorkflowError("corrupt_state", parsed.error);
  }
  fs.mkdirSync(storeDir, { recursive: true });
  const dest = workflowLeasePath(storeDir, parsed.value.workflowId);
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

function assertPositiveTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new WorkflowError(
      "illegal_transition",
      "lease ttlMs must be a finite number > 0.",
    );
  }
}
