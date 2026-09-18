import fs from "node:fs";
import path from "node:path";
import { sanitizeWorkflowId } from "./workflow-id.ts";

const MUTEX_STALE_MS = 5_000;
const MUTEX_WAIT_MS = 5;
const MUTEX_TIMEOUT_MS = 5_000;

export function workflowMutexPath(
  storeDir: string,
  workflowId: string,
): string {
  return path.join(storeDir, `${sanitizeWorkflowId(workflowId)}.mutex`);
}

export function withWorkflowLock<T>(
  storeDir: string,
  workflowId: string,
  fn: () => T,
): T {
  const lockDir = workflowMutexPath(storeDir, workflowId);
  acquireMutex(lockDir);
  try {
    return fn();
  } finally {
    releaseMutex(lockDir);
  }
}

function acquireMutex(lockDir: string): void {
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + MUTEX_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for workflow mutex: ${lockDir}`);
      }
      if (isMutexStale(lockDir)) {
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // Another process may have recovered the stale mutex first.
        }
        continue;
      }
      sleepSync(MUTEX_WAIT_MS);
    }
  }
}

function releaseMutex(lockDir: string): void {
  try {
    fs.rmdirSync(lockDir);
  } catch {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Best-effort unlock; a later stale timeout can recover.
    }
  }
}

function isMutexStale(lockDir: string): boolean {
  try {
    const stat = fs.statSync(lockDir);
    return Date.now() - stat.mtimeMs > MUTEX_STALE_MS;
  } catch {
    return false;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function sleepSync(ms: number): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, ms);
}
