import fs from "node:fs";
import path from "node:path";
import { DeliveryError } from "./delivery-error.ts";
import { parseDeliveryState, type DeliveryState } from "./delivery-state.ts";
import type { WorkflowLease } from "./workflow-lease.ts";
import {
  assertCurrentOwner,
  readLeaseRecordUnlocked,
} from "./workflow-lease-store.ts";
import { withWorkflowLock } from "./workflow-lock.ts";
import { sanitizeWorkflowId } from "./workflow-id.ts";

export function deliveryStatePath(
  storeDir: string,
  workflowId: string,
): string {
  return path.join(storeDir, `${sanitizeWorkflowId(workflowId)}.delivery.json`);
}

export function initializeDeliveryState(options: {
  storeDir: string;
  state: DeliveryState;
}): DeliveryState {
  const parsed = parseDeliveryState(options.state);
  if (!parsed.ok) {
    throw new DeliveryError(parsed.code, parsed.error);
  }
  return withWorkflowLock(options.storeDir, parsed.value.workflowId, () => {
    const dest = deliveryStatePath(options.storeDir, parsed.value.workflowId);
    if (fs.existsSync(dest)) {
      throw new DeliveryError(
        "delivery_exists",
        `Delivery state already exists: ${dest}`,
      );
    }
    replaceDeliveryStateFile(options.storeDir, parsed.value);
    return parsed.value;
  });
}

export function saveDeliveryStateOwned(options: {
  storeDir: string;
  state: DeliveryState;
  lease: Pick<WorkflowLease, "workflowId" | "ownerId" | "fencingToken">;
  now: number;
}): void {
  const parsed = parseDeliveryState(options.state);
  if (!parsed.ok) {
    throw new DeliveryError(parsed.code, parsed.error);
  }
  if (parsed.value.workflowId !== options.lease.workflowId) {
    throw new DeliveryError(
      "not_owner",
      `Lease workflowId ${options.lease.workflowId} does not match delivery ${parsed.value.workflowId}.`,
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
      throw new DeliveryError(
        fencingErrorCode(owned.code),
        `Fenced DeliveryState save rejected: ${owned.code}.`,
      );
    }
    replaceDeliveryStateFile(options.storeDir, parsed.value);
  });
}

/** Fixture/bootstrap only. Delivery transitions must use saveDeliveryStateOwned. */
export function saveDeliveryStateUnfenced(
  storeDir: string,
  state: DeliveryState,
): void {
  const parsed = parseDeliveryState(state);
  if (!parsed.ok) {
    throw new DeliveryError(parsed.code, parsed.error);
  }
  withWorkflowLock(storeDir, parsed.value.workflowId, () => {
    replaceDeliveryStateFile(storeDir, parsed.value);
  });
}

export function loadDeliveryState(
  storeDir: string,
  workflowId: string,
): DeliveryState {
  const dest = deliveryStatePath(storeDir, workflowId);
  if (!fs.existsSync(dest)) {
    throw new DeliveryError(
      "missing_state",
      `Delivery state is missing: ${dest}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(dest, "utf8"));
  } catch {
    throw new DeliveryError(
      "corrupt_state",
      `Delivery state is not valid JSON: ${dest}`,
    );
  }
  const parsed = parseDeliveryState(raw);
  if (!parsed.ok) {
    throw new DeliveryError(parsed.code, parsed.error);
  }
  if (parsed.value.workflowId !== workflowId) {
    throw new DeliveryError(
      "corrupt_state",
      `Persisted delivery workflowId ${parsed.value.workflowId} does not match requested ${workflowId}.`,
    );
  }
  return parsed.value;
}

export function deliveryStateExists(
  storeDir: string,
  workflowId: string,
): boolean {
  return fs.existsSync(deliveryStatePath(storeDir, workflowId));
}

function replaceDeliveryStateFile(
  storeDir: string,
  state: DeliveryState,
): void {
  const parsed = parseDeliveryState(state);
  if (!parsed.ok) {
    throw new DeliveryError(parsed.code, parsed.error);
  }
  fs.mkdirSync(storeDir, { recursive: true });
  const dest = deliveryStatePath(storeDir, parsed.value.workflowId);
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
): DeliveryError["code"] {
  if (code === "lease_expired") {
    return "lease_expired";
  }
  if (code === "fencing_mismatch") {
    return "stale_fencing_token";
  }
  return "not_owner";
}
