import fs from "node:fs";
import { WorkflowError } from "./workflow-error.ts";

export const WORKFLOW_LEASE_SCHEMA_VERSION = 1;

export type WorkflowLeaseRecord = {
  schemaVersion: typeof WORKFLOW_LEASE_SCHEMA_VERSION;
  workflowId: string;
  ownerId: string | null;
  fencingToken: number;
  expiresAt: number | null;
};

export type WorkflowLease = {
  workflowId: string;
  ownerId: string;
  fencingToken: number;
  expiresAt: number;
};

export type LeaseAcquireResult =
  | { ok: true; lease: WorkflowLease }
  | { ok: false; code: "lease_held"; current: WorkflowLeaseRecord };

export type LeaseMutationFailureCode =
  | "stale_owner"
  | "fencing_mismatch"
  | "lease_expired"
  | "missing_lease";

export type LeaseMutationResult =
  | { ok: true; record: WorkflowLeaseRecord }
  | {
      ok: false;
      code: LeaseMutationFailureCode;
      current: WorkflowLeaseRecord | null;
    };

export function emptyLeaseRecord(workflowId: string): WorkflowLeaseRecord {
  return {
    schemaVersion: WORKFLOW_LEASE_SCHEMA_VERSION,
    workflowId,
    ownerId: null,
    fencingToken: 0,
    expiresAt: null,
  };
}

export function isLeaseHeld(record: WorkflowLeaseRecord, now: number): boolean {
  return (
    record.ownerId !== null &&
    record.expiresAt !== null &&
    now < record.expiresAt
  );
}

export function isLeaseReleased(record: WorkflowLeaseRecord): boolean {
  return record.ownerId === null || record.expiresAt === null;
}

export function isLeaseExpired(
  record: WorkflowLeaseRecord,
  now: number,
): boolean {
  return (
    record.ownerId !== null &&
    record.expiresAt !== null &&
    now >= record.expiresAt
  );
}

export function toWorkflowLease(
  record: WorkflowLeaseRecord,
): WorkflowLease | null {
  if (record.ownerId === null || record.expiresAt === null) {
    return null;
  }
  return {
    workflowId: record.workflowId,
    ownerId: record.ownerId,
    fencingToken: record.fencingToken,
    expiresAt: record.expiresAt,
  };
}

export function parseWorkflowLeaseRecord(
  value: unknown,
): { ok: true; value: WorkflowLeaseRecord } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "WorkflowLeaseRecord must be an object." };
  }
  if (value.schemaVersion !== WORKFLOW_LEASE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported WorkflowLease schemaVersion: ${String(value.schemaVersion)}.`,
    };
  }
  const workflowId = parseNonEmptyString(value.workflowId, "workflowId");
  if (!workflowId.ok) {
    return workflowId;
  }
  const ownerId = parseNullableOwnerId(value.ownerId);
  if (!ownerId.ok) {
    return ownerId;
  }
  const fencingToken = parseFencingToken(value.fencingToken);
  if (!fencingToken.ok) {
    return fencingToken;
  }
  const expiresAt = parseNullableExpiresAt(value.expiresAt);
  if (!expiresAt.ok) {
    return expiresAt;
  }
  if (ownerId.value === null && expiresAt.value !== null) {
    return {
      ok: false,
      error: "Released lease cannot have expiresAt set.",
    };
  }
  if (ownerId.value !== null && expiresAt.value === null) {
    return {
      ok: false,
      error: "Held lease must have expiresAt set.",
    };
  }
  return {
    ok: true,
    value: {
      schemaVersion: WORKFLOW_LEASE_SCHEMA_VERSION,
      workflowId: workflowId.value,
      ownerId: ownerId.value,
      fencingToken: fencingToken.value,
      expiresAt: expiresAt.value,
    },
  };
}

export function systemNowMs(): number {
  return Date.now();
}

export function readFileClock(clockPath: string): number {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(clockPath, "utf8"));
  } catch {
    throw new WorkflowError(
      "corrupt_state",
      `Lease clock is missing or not valid JSON: ${clockPath}`,
    );
  }
  if (
    !isRecord(raw) ||
    typeof raw.now !== "number" ||
    !Number.isFinite(raw.now)
  ) {
    throw new WorkflowError(
      "corrupt_state",
      `Lease clock.now must be a finite number: ${clockPath}`,
    );
  }
  return raw.now;
}

export function writeFileClock(clockPath: string, now: number): void {
  fs.writeFileSync(clockPath, `${JSON.stringify({ now }, null, 2)}\n`);
}

export function fileNowMs(clockPath: string): () => number {
  return () => readFileClock(clockPath);
}

function parseNullableOwnerId(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) {
    return { ok: true, value: null };
  }
  return parseNonEmptyString(value, "ownerId");
}

function parseFencingToken(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { ok: false, error: "fencingToken must be an integer >= 0." };
  }
  return { ok: true, value };
}

function parseNullableExpiresAt(
  value: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: "expiresAt must be a finite number or null." };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
