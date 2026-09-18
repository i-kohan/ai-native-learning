import fs from "node:fs";
import path from "node:path";
import { readFileClock } from "./workflow-lease.ts";
import {
  acquireWorkflowLease,
  createWorkflowOwnerId,
  releaseWorkflowLease,
  renewWorkflowLease,
} from "./workflow-lease-store.ts";
import { loadWorkflowState, saveWorkflowStateOwned } from "./workflow-store.ts";
import { admitTerminal } from "./workflow-state.ts";
import { WorkflowError } from "./workflow-error.ts";

export const OWN01_COMMIT_A = "commit-from-A";
export const OWN01_COMMIT_B = "commit-from-B";

export type OwnershipRole =
  | "hold-then-stale"
  | "try-acquire"
  | "takeover-then-commit";

export type OwnershipInvocationEvidence = {
  role: OwnershipRole;
  workflowId: string;
  pid: number;
  ppid: number;
  ownerId: string | null;
  fencingToken: number | null;
  acquired: boolean;
  blocked: boolean;
  commitOk: boolean | null;
  commitCode: string | null;
  renewOk: boolean | null;
  renewCode: string | null;
  releaseOk: boolean | null;
  releaseCode: string | null;
  commitMarker: string | null;
};

export function ownershipEvidencePath(storeDir: string, name: string): string {
  return path.join(storeDir, `${name}.ownership.json`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const now = () => readFileClock(args.clockPath);
  const ownerId = createWorkflowOwnerId();
  const evidence: OwnershipInvocationEvidence = {
    role: args.role,
    workflowId: args.workflowId,
    pid: process.pid,
    ppid: process.ppid,
    ownerId: null,
    fencingToken: null,
    acquired: false,
    blocked: false,
    commitOk: null,
    commitCode: null,
    renewOk: null,
    renewCode: null,
    releaseOk: null,
    releaseCode: null,
    commitMarker: null,
  };

  try {
    if (args.waitPath && args.role === "try-acquire") {
      waitForFile(args.waitPath, args.waitTimeoutMs);
    }
    if (args.role === "try-acquire") {
      const acquired = acquireWorkflowLease({
        storeDir: args.storeDir,
        workflowId: args.workflowId,
        ownerId,
        ttlMs: args.ttlMs,
        now: now(),
      });
      if (acquired.ok) {
        evidence.acquired = true;
        evidence.ownerId = acquired.lease.ownerId;
        evidence.fencingToken = acquired.lease.fencingToken;
      } else {
        evidence.blocked = acquired.code === "lease_held";
      }
      writeEvidence(args.evidencePath, evidence);
      return;
    }

    const acquired = acquireWorkflowLease({
      storeDir: args.storeDir,
      workflowId: args.workflowId,
      ownerId,
      ttlMs: args.ttlMs,
      now: now(),
    });
    if (!acquired.ok) {
      evidence.blocked = acquired.code === "lease_held";
      writeEvidence(args.evidencePath, evidence);
      process.exit(
        args.role === "hold-then-stale" || args.role === "takeover-then-commit"
          ? 1
          : 0,
      );
      return;
    }

    evidence.acquired = true;
    evidence.ownerId = acquired.lease.ownerId;
    evidence.fencingToken = acquired.lease.fencingToken;
    writeEvidence(args.readyPath ?? args.evidencePath, evidence);

    if (args.waitPath) {
      waitForFile(args.waitPath, args.waitTimeoutMs);
    }

    if (args.role === "hold-then-stale") {
      const commit = tryCommit({
        storeDir: args.storeDir,
        lease: acquired.lease,
        now: now(),
        marker: OWN01_COMMIT_A,
      });
      evidence.commitOk = commit.ok;
      evidence.commitCode = commit.code;
      evidence.commitMarker = OWN01_COMMIT_A;
      const renewed = renewWorkflowLease({
        storeDir: args.storeDir,
        lease: acquired.lease,
        ttlMs: args.ttlMs,
        now: now(),
      });
      evidence.renewOk = renewed.ok;
      evidence.renewCode = renewed.ok ? null : renewed.code;
      const released = releaseWorkflowLease({
        storeDir: args.storeDir,
        lease: acquired.lease,
      });
      evidence.releaseOk = released.ok;
      evidence.releaseCode = released.ok ? null : released.code;
      writeEvidence(args.evidencePath, evidence);
      return;
    }

    const commit = tryCommit({
      storeDir: args.storeDir,
      lease: acquired.lease,
      now: now(),
      marker: OWN01_COMMIT_B,
    });
    evidence.commitOk = commit.ok;
    evidence.commitCode = commit.code;
    evidence.commitMarker = OWN01_COMMIT_B;
    if (commit.ok) {
      releaseWorkflowLease({
        storeDir: args.storeDir,
        lease: acquired.lease,
      });
    }
    writeEvidence(args.evidencePath, evidence);
    if (!commit.ok) {
      process.exit(1);
    }
  } catch (error) {
    writeEvidence(args.evidencePath, evidence);
    throw error;
  }
}

function tryCommit(options: {
  storeDir: string;
  lease: {
    workflowId: string;
    ownerId: string;
    fencingToken: number;
    expiresAt: number;
  };
  now: number;
  marker: string;
}): { ok: boolean; code: string | null } {
  try {
    const current = loadWorkflowState(
      options.storeDir,
      options.lease.workflowId,
    );
    const next = admitTerminal({
      current,
      outcome: {
        workflowStatus: "failure",
        failureReason: options.marker,
      },
    });
    saveWorkflowStateOwned({
      storeDir: options.storeDir,
      state: next,
      lease: options.lease,
      now: options.now,
    });
    return { ok: true, code: null };
  } catch (error) {
    if (error instanceof WorkflowError) {
      return { ok: false, code: error.code };
    }
    throw error;
  }
}

function writeEvidence(
  dest: string,
  evidence: OwnershipInvocationEvidence,
): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(evidence, null, 2)}\n`);
}

function waitForFile(filePath: string, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    const buffer = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(buffer, 0, 0, 20);
  }
}

function parseArgs(argv: string[]): {
  role: OwnershipRole;
  workflowId: string;
  storeDir: string;
  clockPath: string;
  ttlMs: number;
  evidencePath: string;
  readyPath?: string;
  waitPath?: string;
  waitTimeoutMs: number;
} {
  const role = flagValue(argv, "--role") as OwnershipRole | undefined;
  const workflowId = flagValue(argv, "--workflow-id");
  const storeDir = flagValue(argv, "--store-dir");
  const clockPath = flagValue(argv, "--clock-path");
  const ttlRaw = flagValue(argv, "--ttl-ms");
  const evidencePath = flagValue(argv, "--evidence-path");
  if (
    !role ||
    !workflowId ||
    !storeDir ||
    !clockPath ||
    !ttlRaw ||
    !evidencePath
  ) {
    throw new Error(
      "Usage: run-ownership-invocation --role hold-then-stale|try-acquire|takeover-then-commit --workflow-id ID --store-dir DIR --clock-path FILE --ttl-ms N --evidence-path FILE",
    );
  }
  if (
    role !== "hold-then-stale" &&
    role !== "try-acquire" &&
    role !== "takeover-then-commit"
  ) {
    throw new Error(`Unsupported --role: ${role}`);
  }
  const ttlMs = Number(ttlRaw);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`Unsupported --ttl-ms: ${ttlRaw}`);
  }
  const waitTimeoutRaw = optionalFlagValue(argv, "--wait-timeout-ms");
  return {
    role,
    workflowId,
    storeDir,
    clockPath,
    ttlMs,
    evidencePath,
    readyPath: optionalFlagValue(argv, "--ready-path"),
    waitPath: optionalFlagValue(argv, "--wait-path"),
    waitTimeoutMs: waitTimeoutRaw ? Number(waitTimeoutRaw) : 20_000,
  };
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

function optionalFlagValue(argv: string[], name: string): string | undefined {
  return flagValue(argv, name);
}

const isDirectRun = process.argv.some((arg) =>
  arg.includes("run-ownership-invocation.ts"),
);
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
