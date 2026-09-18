import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sanitizeWorkflowId } from "./workflow-id.ts";

export const DEFAULT_WORKFLOW_MUTEX_TIMEOUT_MS = 5_000;

const MUTEX_WAIT_MS = 5;

export type WorkflowMutexHandle = {
  lockPath: string;
  token: string;
  released: boolean;
};

export function workflowMutexPath(
  storeDir: string,
  workflowId: string,
): string {
  return path.join(storeDir, `${sanitizeWorkflowId(workflowId)}.mutex.lock`);
}

export function withWorkflowLock<T>(
  storeDir: string,
  workflowId: string,
  fn: () => T,
): T {
  const handle = acquireWorkflowMutex({ storeDir, workflowId });
  try {
    return fn();
  } finally {
    releaseWorkflowMutex(handle);
  }
}

export function acquireWorkflowMutex(options: {
  storeDir: string;
  workflowId: string;
  timeoutMs?: number;
}): WorkflowMutexHandle {
  const lockPath = workflowMutexPath(options.storeDir, options.workflowId);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORKFLOW_MUTEX_TIMEOUT_MS;
  const flags =
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const token = randomUUID();
      const fd = fs.openSync(lockPath, flags);
      try {
        fs.writeFileSync(fd, `${token}\n`);
      } catch (error) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // This process created the file; fail closed if cleanup also fails.
        }
        throw error;
      } finally {
        fs.closeSync(fd);
      }
      return { lockPath, token, released: false };
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for workflow mutex: ${lockPath}`);
      }
      sleepSync(MUTEX_WAIT_MS);
    }
  }
}

export function releaseWorkflowMutex(handle: WorkflowMutexHandle): void {
  if (handle.released) {
    return;
  }
  handle.released = true;
  const current = readHolderToken(handle.lockPath);
  if (current !== handle.token) {
    return;
  }
  // Safe under this protocol: a replacement lock cannot be created while this
  // file exists. Not a general compare-and-delete. External unlink is unsupported.
  try {
    fs.unlinkSync(handle.lockPath);
  } catch {
    // Already gone; do not delete a replacement lock.
  }
}

function readHolderToken(lockPath: string): string | null {
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
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
