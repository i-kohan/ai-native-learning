import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../src/config.ts";
import { evaluateOwnershipAssertions } from "../src/ownership-probe.ts";
import {
  OWN01_COMMIT_A,
  OWN01_COMMIT_B,
  ownershipEvidencePath,
  type OwnershipInvocationEvidence,
} from "../src/run-ownership-invocation.ts";
import {
  acquireWorkflowLease,
  loadWorkflowLeaseRecord,
  releaseWorkflowLease,
  renewWorkflowLease,
} from "../src/workflow-lease-store.ts";
import { WorkflowError } from "../src/workflow-error.ts";
import {
  initializeWorkflow,
  loadWorkflowState,
  saveWorkflowStateOwned,
} from "../src/workflow-store.ts";
import { admitTerminal } from "../src/workflow-state.ts";

function tmpStore(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "own01-"));
}

function dummyWorkspace(root: string, workflowId: string) {
  return {
    id: workflowId,
    root,
    baseRevision: "abc123",
    ref: "HEAD",
    headRevision: "abc123",
    workingTreeFingerprint: "fingerprint",
  };
}

function initWorkflow(storeDir: string, workflowId: string) {
  return initializeWorkflow({
    storeDir,
    workflowId,
    task: "ownership test",
    workspace: dummyWorkspace(storeDir, workflowId),
  });
}

describe("workflow lease acquire/renew/release", () => {
  it("acquires a free workflow with fencing token 1", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-free";
    initWorkflow(storeDir, workflowId);
    const acquired = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }
    assert.equal(acquired.lease.fencingToken, 1);
    assert.equal(acquired.lease.ownerId, "owner-a");
    assert.equal(acquired.lease.expiresAt, 2_000);
  });

  it("rejects acquire while another owner holds an unexpired lease", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-busy";
    initWorkflow(storeDir, workflowId);
    const first = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    assert.equal(first.ok, true);
    const second = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-b",
      ttlMs: 1_000,
      now: 1_500,
    });
    assert.equal(second.ok, false);
    if (second.ok) {
      return;
    }
    assert.equal(second.code, "lease_held");
  });

  it("does not treat acquire(currentOwner) as renew", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-same-owner";
    initWorkflow(storeDir, workflowId);
    const first = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    assert.equal(first.ok, true);
    const second = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 5_000,
      now: 1_100,
    });
    assert.equal(second.ok, false);
    if (!first.ok || second.ok) {
      return;
    }
    assert.equal(second.code, "lease_held");
    const current = loadWorkflowLeaseRecord(storeDir, workflowId);
    assert.equal(current.fencingToken, first.lease.fencingToken);
    assert.equal(current.expiresAt, first.lease.expiresAt);
  });

  it("takes over an expired lease with a newer fencing token", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-expire";
    initWorkflow(storeDir, workflowId);
    const first = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    assert.equal(first.ok, true);
    const second = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-b",
      ttlMs: 1_000,
      now: 2_000,
    });
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) {
      return;
    }
    assert.ok(second.lease.fencingToken > first.lease.fencingToken);
    assert.equal(second.lease.ownerId, "owner-b");
  });

  it("gives the same ownerId a new epoch after expiry instead of renewing", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-reacquire";
    initWorkflow(storeDir, workflowId);
    const first = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    assert.equal(first.ok, true);
    const second = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 2_000,
    });
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) {
      return;
    }
    assert.ok(second.lease.fencingToken > first.lease.fencingToken);
  });

  it("renews only the current unexpired owner and keeps the fencing token", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-renew";
    initWorkflow(storeDir, workflowId);
    const acquired = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }
    const renewed = renewWorkflowLease({
      storeDir,
      lease: acquired.lease,
      ttlMs: 1_000,
      now: 1_500,
    });
    assert.equal(renewed.ok, true);
    if (!renewed.ok) {
      return;
    }
    assert.equal(renewed.record.fencingToken, acquired.lease.fencingToken);
    assert.equal(renewed.record.expiresAt, 2_500);
  });

  it("rejects renew after expiry even for the same owner", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-renew-expired";
    initWorkflow(storeDir, workflowId);
    const acquired = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }
    const renewed = renewWorkflowLease({
      storeDir,
      lease: acquired.lease,
      ttlMs: 1_000,
      now: 2_000,
    });
    assert.equal(renewed.ok, false);
    if (renewed.ok) {
      return;
    }
    assert.equal(renewed.code, "lease_expired");
  });

  it("rejects stale renew and stale release after takeover", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-stale";
    initWorkflow(storeDir, workflowId);
    const first = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    const second = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-b",
      ttlMs: 1_000,
      now: 3_000,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) {
      return;
    }
    const renewed = renewWorkflowLease({
      storeDir,
      lease: first.lease,
      ttlMs: 1_000,
      now: 3_000,
    });
    const released = releaseWorkflowLease({
      storeDir,
      lease: first.lease,
    });
    assert.equal(renewed.ok, false);
    assert.equal(released.ok, false);
    const current = loadWorkflowLeaseRecord(storeDir, workflowId);
    assert.equal(current.ownerId, "owner-b");
    assert.equal(current.fencingToken, second.lease.fencingToken);
  });

  it("release keeps fencingToken and does not reset the epoch", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-release";
    initWorkflow(storeDir, workflowId);
    const acquired = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }
    const released = releaseWorkflowLease({
      storeDir,
      lease: acquired.lease,
    });
    assert.equal(released.ok, true);
    if (!released.ok) {
      return;
    }
    assert.equal(released.record.ownerId, null);
    assert.equal(released.record.expiresAt, null);
    assert.equal(released.record.fencingToken, acquired.lease.fencingToken);
    const next = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-b",
      ttlMs: 1_000,
      now: 1_100,
    });
    assert.equal(next.ok, true);
    if (!next.ok) {
      return;
    }
    assert.equal(next.lease.fencingToken, acquired.lease.fencingToken + 1);
  });
});

describe("fenced WorkflowState save", () => {
  it("allows the current owner to persist a distinguishable transition", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-fenced-ok";
    const initial = initWorkflow(storeDir, workflowId);
    const acquired = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-b",
      ttlMs: 1_000,
      now: 1_000,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) {
      return;
    }
    const next = admitTerminal({
      current: initial,
      outcome: {
        workflowStatus: "failure",
        failureReason: OWN01_COMMIT_B,
      },
    });
    saveWorkflowStateOwned({
      storeDir,
      state: next,
      lease: acquired.lease,
      now: 1_000,
    });
    const loaded = loadWorkflowState(storeDir, workflowId);
    assert.equal(loaded.phase, "terminal");
    if (loaded.phase !== "terminal") {
      return;
    }
    assert.equal(loaded.outcome.failureReason, OWN01_COMMIT_B);
  });

  it("rejects a stale owner's authoritative commit after takeover", () => {
    const storeDir = tmpStore();
    const workflowId = "wf-fenced-stale";
    const initial = initWorkflow(storeDir, workflowId);
    const first = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: 1_000,
    });
    const second = acquireWorkflowLease({
      storeDir,
      workflowId,
      ownerId: "owner-b",
      ttlMs: 1_000,
      now: 3_000,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) {
      return;
    }
    const stale = admitTerminal({
      current: initial,
      outcome: {
        workflowStatus: "failure",
        failureReason: OWN01_COMMIT_A,
      },
    });
    assert.throws(
      () =>
        saveWorkflowStateOwned({
          storeDir,
          state: stale,
          lease: first.lease,
          now: 3_000,
        }),
      (error: unknown) =>
        error instanceof WorkflowError &&
        (error.code === "stale_fencing_token" || error.code === "not_owner"),
    );
    const current = loadWorkflowState(storeDir, workflowId);
    assert.equal(current.phase, "spec_required");
  });
});

describe("cross-process acquire mutex", () => {
  it("allows only one of two racing processes to acquire", async () => {
    const storeDir = tmpStore();
    const workflowId = "wf-race";
    initWorkflow(storeDir, workflowId);
    const clockPath = path.join(storeDir, "clock.json");
    fs.writeFileSync(clockPath, `${JSON.stringify({ now: 1_000 }, null, 2)}\n`);
    const startPath = path.join(storeDir, "start");
    const leftPath = ownershipEvidencePath(storeDir, "race-left");
    const rightPath = ownershipEvidencePath(storeDir, "race-right");
    const left = spawnTryAcquire(
      storeDir,
      workflowId,
      clockPath,
      leftPath,
      startPath,
    );
    const right = spawnTryAcquire(
      storeDir,
      workflowId,
      clockPath,
      rightPath,
      startPath,
    );
    await waitSpawned(left);
    await waitSpawned(right);
    fs.writeFileSync(startPath, "go\n");
    await Promise.all([waitChild(left), waitChild(right)]);
    const leftEvidence = JSON.parse(
      fs.readFileSync(leftPath, "utf8"),
    ) as OwnershipInvocationEvidence;
    const rightEvidence = JSON.parse(
      fs.readFileSync(rightPath, "utf8"),
    ) as OwnershipInvocationEvidence;
    const acquiredCount =
      Number(leftEvidence.acquired) + Number(rightEvidence.acquired);
    const blockedCount =
      Number(leftEvidence.blocked) + Number(rightEvidence.blocked);
    assert.equal(acquiredCount, 1);
    assert.equal(blockedCount, 1);
    assert.notEqual(leftEvidence.pid, rightEvidence.pid);
  });
});

describe("OWN01 decision rule", () => {
  it("passes only the full stale-owner fencing sequence", () => {
    const processAReady = sampleProcess({
      role: "hold-then-stale",
      pid: 11,
      ownerId: "owner-1",
      fencingToken: 1,
      acquired: true,
    });
    const processA = {
      ...processAReady,
      commitOk: false,
      commitCode: "not_owner",
      commitMarker: OWN01_COMMIT_A,
      renewOk: false,
      renewCode: "stale_owner",
      releaseOk: false,
      releaseCode: "stale_owner",
    };
    const processBusy = sampleProcess({
      role: "try-acquire",
      pid: 12,
      acquired: false,
      blocked: true,
    });
    const processBReady = sampleProcess({
      role: "takeover-then-commit",
      pid: 13,
      ownerId: "owner-2",
      fencingToken: 2,
      acquired: true,
    });
    const processB = {
      ...processBReady,
      commitOk: true,
      commitMarker: OWN01_COMMIT_B,
    };
    const assertions = evaluateOwnershipAssertions({
      processAReady,
      processA,
      processBusy,
      processBReady,
      processB,
      leaseAfterStaleOwnerId: "owner-2",
      leaseAfterStaleToken: 2,
      finalCommitMarker: OWN01_COMMIT_B,
      finalPhase: "terminal",
    });
    assert.equal(Object.values(assertions).every(Boolean), true);
  });

  it("fails if final state still contains A's commit marker", () => {
    const processAReady = sampleProcess({
      role: "hold-then-stale",
      pid: 11,
      ownerId: "owner-1",
      fencingToken: 1,
      acquired: true,
    });
    const processA = {
      ...processAReady,
      commitOk: true,
      commitMarker: OWN01_COMMIT_A,
      renewOk: false,
      releaseOk: false,
    };
    const processBusy = sampleProcess({
      role: "try-acquire",
      pid: 12,
      blocked: true,
    });
    const processBReady = sampleProcess({
      role: "takeover-then-commit",
      pid: 13,
      ownerId: "owner-2",
      fencingToken: 2,
      acquired: true,
    });
    const assertions = evaluateOwnershipAssertions({
      processAReady,
      processA,
      processBusy,
      processBReady,
      processB: {
        ...processBReady,
        commitOk: true,
        commitMarker: OWN01_COMMIT_B,
      },
      leaseAfterStaleOwnerId: "owner-2",
      leaseAfterStaleToken: 2,
      finalCommitMarker: OWN01_COMMIT_A,
      finalPhase: "terminal",
    });
    assert.equal(assertions.staleACommitRejected, false);
    assert.equal(assertions.finalStateIsB, false);
  });
});

function sampleProcess(
  fields: Partial<OwnershipInvocationEvidence> &
    Pick<OwnershipInvocationEvidence, "role" | "pid">,
): OwnershipInvocationEvidence {
  return {
    workflowId: "OWN01",
    ppid: 1,
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
    ...fields,
  };
}

function spawnTryAcquire(
  storeDir: string,
  workflowId: string,
  clockPath: string,
  evidencePath: string,
  waitPath: string,
) {
  const harnessDir = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(harnessDir, "../src/run-ownership-invocation.ts");
  const tsxCli = path.join(REPO_ROOT, "harness/node_modules/tsx/dist/cli.mjs");
  return spawn(
    process.execPath,
    [
      tsxCli,
      script,
      "--role",
      "try-acquire",
      "--workflow-id",
      workflowId,
      "--store-dir",
      storeDir,
      "--clock-path",
      clockPath,
      "--ttl-ms",
      "1000",
      "--evidence-path",
      evidencePath,
      "--wait-path",
      waitPath,
    ],
    {
      cwd: path.join(REPO_ROOT, "harness"),
      env: process.env,
      stdio: "inherit",
    },
  );
}

function waitSpawned(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.pid) {
      resolve();
      return;
    }
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
}

function waitChild(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
}
