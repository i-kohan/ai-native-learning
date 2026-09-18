import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./config.ts";
import {
  OWN01_COMMIT_A,
  OWN01_COMMIT_B,
  ownershipEvidencePath,
  type OwnershipInvocationEvidence,
  type OwnershipRole,
} from "./run-ownership-invocation.ts";
import { writeFileClock } from "./workflow-lease.ts";
import { loadWorkflowLeaseRecord } from "./workflow-lease-store.ts";
import { initializeWorkflow, loadWorkflowState } from "./workflow-store.ts";

export const OWNERSHIP_PROBE_ID = "OWN01";

export type OwnershipProbeResult = {
  taskId: typeof OWNERSHIP_PROBE_ID;
  taskKind: "mechanism_probe";
  mechanism: "workflow_ownership_fencing";
  passed: boolean;
  workflowId: string;
  processA: OwnershipInvocationEvidence | null;
  processBusy: OwnershipInvocationEvidence | null;
  processB: OwnershipInvocationEvidence | null;
  tokenN: number | null;
  tokenB: number | null;
  leaseOwnerAfterStaleRelease: string | null;
  finalCommitMarker: string | null;
  assertions: Record<string, boolean>;
  evidencePath: string;
};

const DECISION_RULE = [
  "OWN01 passes only if all are true:",
  "1. Process A acquires the workflow with fencing token N.",
  "2. While A's lease is valid, Process B cannot acquire the workflow.",
  "3. After expiry, B acquires with fencing token strictly greater than N.",
  "4. Stale A cannot authoritatively commit WorkflowState.",
  "5. Stale A cannot renew the old ownership epoch.",
  "6. Stale A cannot release B's ownership.",
  "7. B remains current owner after A's stale release attempt.",
  "8. Current B can authoritatively commit a distinguishable WorkflowState transition.",
  "9. Final WorkflowState contains only B's committed result.",
  "10. Ownership is decided by harness/store logic, never by the model.",
].join("\n");

const VIRTUAL_START = 1_000;
const VIRTUAL_TTL = 1_000;
const VIRTUAL_AFTER_EXPIRY = 3_000;

export async function runOwnershipProbe(): Promise<OwnershipProbeResult> {
  const stamp = timestamp();
  const storeDir = path.join(
    REPO_ROOT,
    "traces",
    "workflows",
    `OWN01-${stamp}`,
  );
  fs.mkdirSync(storeDir, { recursive: true });
  const workflowId = `OWN01-${stamp}`;
  const clockPath = path.join(storeDir, "clock.json");
  writeFileClock(clockPath, VIRTUAL_START);
  initializeWorkflow({
    storeDir,
    workflowId,
    task: "OWN01 ownership fencing probe",
    workspace: {
      id: workflowId,
      root: storeDir,
      baseRevision: "ownership-probe",
      ref: "HEAD",
      headRevision: "ownership-probe",
      workingTreeFingerprint: "ownership-probe",
    },
  });

  const wakeA = path.join(storeDir, "wake-a");
  const commitB = path.join(storeDir, "commit-b");
  const readyA = ownershipEvidencePath(storeDir, "A-ready");
  const evidenceA = ownershipEvidencePath(storeDir, "A");
  const evidenceBusy = ownershipEvidencePath(storeDir, "B-busy");
  const readyB = ownershipEvidencePath(storeDir, "B-ready");
  const evidenceB = ownershipEvidencePath(storeDir, "B");

  const childA = spawnOwnershipChild({
    storeDir,
    workflowId,
    clockPath,
    role: "hold-then-stale",
    evidencePath: evidenceA,
    readyPath: readyA,
    waitPath: wakeA,
  });

  await waitForFile(readyA);
  const processAReady = readEvidence(readyA);

  spawnOwnershipSync({
    storeDir,
    workflowId,
    clockPath,
    role: "try-acquire",
    evidencePath: evidenceBusy,
  });
  const processBusy = readEvidence(evidenceBusy);

  writeFileClock(clockPath, VIRTUAL_AFTER_EXPIRY);

  const childB = spawnOwnershipChild({
    storeDir,
    workflowId,
    clockPath,
    role: "takeover-then-commit",
    evidencePath: evidenceB,
    readyPath: readyB,
    waitPath: commitB,
  });

  await waitForFile(readyB);
  const processBReady = readEvidence(readyB);

  fs.writeFileSync(wakeA, "wake\n");
  await waitExit(childA);
  const processA = readEvidence(evidenceA);

  const leaseAfterStale = loadWorkflowLeaseRecord(storeDir, workflowId);
  fs.writeFileSync(commitB, "commit\n");
  await waitExit(childB);
  const processB = readEvidence(evidenceB);
  const finalState = loadWorkflowState(storeDir, workflowId);

  const assertions = evaluateOwnershipAssertions({
    processAReady,
    processA,
    processBusy,
    processBReady,
    processB,
    leaseAfterStaleOwnerId: leaseAfterStale.ownerId,
    leaseAfterStaleToken: leaseAfterStale.fencingToken,
    finalCommitMarker:
      finalState.phase === "terminal"
        ? (finalState.outcome.failureReason ?? null)
        : null,
    finalPhase: finalState.phase,
  });
  const result: OwnershipProbeResult = {
    taskId: OWNERSHIP_PROBE_ID,
    taskKind: "mechanism_probe",
    mechanism: "workflow_ownership_fencing",
    passed: Object.values(assertions).every(Boolean),
    workflowId,
    processA,
    processBusy,
    processB,
    tokenN: processAReady.fencingToken,
    tokenB: processBReady.fencingToken,
    leaseOwnerAfterStaleRelease: leaseAfterStale.ownerId,
    finalCommitMarker:
      finalState.phase === "terminal"
        ? (finalState.outcome.failureReason ?? null)
        : null,
    assertions,
    evidencePath: "",
  };
  result.evidencePath = writeOwnershipEvidence(storeDir, result);
  return result;
}

export function evaluateOwnershipAssertions(input: {
  processAReady: OwnershipInvocationEvidence;
  processA: OwnershipInvocationEvidence;
  processBusy: OwnershipInvocationEvidence;
  processBReady: OwnershipInvocationEvidence;
  processB: OwnershipInvocationEvidence;
  leaseAfterStaleOwnerId: string | null;
  leaseAfterStaleToken: number;
  finalCommitMarker: string | null;
  finalPhase: string;
}): Record<string, boolean> {
  const tokenN = input.processAReady.fencingToken;
  const tokenB = input.processBReady.fencingToken;
  return {
    aAcquiredTokenN:
      input.processAReady.acquired &&
      typeof tokenN === "number" &&
      tokenN >= 1 &&
      input.processAReady.pid > 0,
    bBlockedWhileAValid:
      input.processBusy.blocked &&
      input.processBusy.acquired === false &&
      input.processBusy.pid !== input.processAReady.pid,
    bAcquiredNewerTokenAfterExpiry:
      input.processBReady.acquired &&
      typeof tokenN === "number" &&
      typeof tokenB === "number" &&
      tokenB > tokenN &&
      input.processBReady.pid !== input.processAReady.pid &&
      input.processBReady.pid !== input.processBusy.pid,
    staleACommitRejected:
      input.processA.commitOk === false &&
      input.processA.commitMarker === OWN01_COMMIT_A &&
      input.processA.commitCode !== null,
    staleARenewRejected: input.processA.renewOk === false,
    staleAReleaseRejected: input.processA.releaseOk === false,
    bRemainedOwnerAfterStaleRelease:
      input.leaseAfterStaleOwnerId === input.processBReady.ownerId &&
      input.leaseAfterStaleToken === tokenB,
    bCommitSucceeded:
      input.processB.commitOk === true &&
      input.processB.commitMarker === OWN01_COMMIT_B,
    finalStateIsB:
      input.finalPhase === "terminal" &&
      input.finalCommitMarker === OWN01_COMMIT_B,
    ownershipNotModelDecided:
      input.processAReady.ownerId !== null &&
      input.processBReady.ownerId !== null &&
      input.processAReady.ownerId.startsWith("owner-") &&
      input.processBReady.ownerId.startsWith("owner-") &&
      input.processBusy.blocked,
  };
}

export function isExpectedOWN01Outcome(result: OwnershipProbeResult): boolean {
  return result.passed;
}

export function printOwnershipProbeSummary(result: OwnershipProbeResult): void {
  console.log("\n=== OWN01 Ownership / Fencing Probe ===");
  console.log(DECISION_RULE);
  console.log(`passed: ${result.passed ? "yes" : "no"}`);
  console.log(`workflow: ${result.workflowId}`);
  console.log(`tokenN: ${result.tokenN ?? "(none)"}`);
  console.log(`tokenB: ${result.tokenB ?? "(none)"}`);
  for (const [key, value] of Object.entries(result.assertions)) {
    console.log(`  ${key}: ${value ? "yes" : "NO"}`);
  }
  console.log(`evidence: ${result.evidencePath}`);
}

function spawnOwnershipChild(options: {
  storeDir: string;
  workflowId: string;
  clockPath: string;
  role: OwnershipRole;
  evidencePath: string;
  readyPath?: string;
  waitPath?: string;
}): ChildProcess {
  const args = ownershipArgs(options);
  return spawn(process.execPath, args, {
    cwd: path.join(REPO_ROOT, "harness"),
    env: process.env,
    stdio: "inherit",
  });
}

function spawnOwnershipSync(options: {
  storeDir: string;
  workflowId: string;
  clockPath: string;
  role: OwnershipRole;
  evidencePath: string;
}): void {
  const spawned = spawnSync(process.execPath, ownershipArgs(options), {
    cwd: path.join(REPO_ROOT, "harness"),
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (!fs.existsSync(options.evidencePath)) {
    throw new Error(
      `Missing ownership evidence for ${options.role}:\n${spawned.stdout}\n${spawned.stderr}`,
    );
  }
}

function ownershipArgs(options: {
  storeDir: string;
  workflowId: string;
  clockPath: string;
  role: OwnershipRole;
  evidencePath: string;
  readyPath?: string;
  waitPath?: string;
}): string[] {
  const harnessDir = path.dirname(fileURLToPath(import.meta.url));
  const script = path.join(harnessDir, "run-ownership-invocation.ts");
  const tsxCli = path.join(harnessDir, "../node_modules/tsx/dist/cli.mjs");
  const args = [
    tsxCli,
    script,
    "--role",
    options.role,
    "--workflow-id",
    options.workflowId,
    "--store-dir",
    options.storeDir,
    "--clock-path",
    options.clockPath,
    "--ttl-ms",
    String(VIRTUAL_TTL),
    "--evidence-path",
    options.evidencePath,
  ];
  if (options.readyPath) {
    args.push("--ready-path", options.readyPath);
  }
  if (options.waitPath) {
    args.push("--wait-path", options.waitPath);
  }
  return args;
}

function readEvidence(filePath: string): OwnershipInvocationEvidence {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8"),
  ) as OwnershipInvocationEvidence;
}

function waitForFile(filePath: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (fs.existsSync(filePath)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${filePath}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function waitExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      resolve();
    });
  });
}

function writeOwnershipEvidence(
  storeDir: string,
  result: OwnershipProbeResult,
): string {
  const stamp = timestamp();
  const tracesDir = path.join(REPO_ROOT, "traces");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/19-orchestration-as-distributed-systems/traces",
  );
  fs.mkdirSync(tracesDir, { recursive: true });
  fs.mkdirSync(lessonDir, { recursive: true });
  const payload = `${JSON.stringify({ ...result, decisionRule: DECISION_RULE }, null, 2)}\n`;
  const report = `${formatOwnershipReport(result)}\n`;
  const jsonName = `OWN01-ownership-${stamp}.json`;
  const reportName = `OWN01-ownership-${stamp}.txt`;
  const hostPath = path.join(tracesDir, jsonName);
  fs.writeFileSync(hostPath, payload);
  fs.writeFileSync(path.join(tracesDir, reportName), report);
  fs.writeFileSync(path.join(storeDir, jsonName), payload);
  fs.writeFileSync(path.join(storeDir, reportName), report);
  fs.writeFileSync(path.join(lessonDir, jsonName), payload);
  fs.writeFileSync(path.join(lessonDir, reportName), report);
  return hostPath;
}

function formatOwnershipReport(result: OwnershipProbeResult): string {
  return [
    "=== OWN01 Ownership / Fencing Probe ===",
    DECISION_RULE,
    "",
    `passed: ${result.passed ? "yes" : "no"}`,
    `workflowId: ${result.workflowId}`,
    `tokenN: ${result.tokenN ?? "(none)"}`,
    `tokenB: ${result.tokenB ?? "(none)"}`,
    `lease_owner_after_stale_release: ${result.leaseOwnerAfterStaleRelease ?? "(none)"}`,
    `final_commit_marker: ${result.finalCommitMarker ?? "(none)"}`,
    processLine("A", result.processA),
    processLine("B-busy", result.processBusy),
    processLine("B", result.processB),
    "",
    "Limitation: fencing protects authoritative WorkflowState/lease writes only.",
    "It does not prove a stale worker cannot already have performed external side effects.",
    "",
    "Assertions",
    ...Object.entries(result.assertions).map(
      ([key, value]) => `- ${key}: ${value ? "yes" : "NO"}`,
    ),
  ].join("\n");
}

function processLine(
  label: string,
  item: OwnershipInvocationEvidence | null,
): string {
  if (!item) {
    return `  ${label}: (missing)`;
  }
  return `  ${label} pid=${item.pid} acquired=${item.acquired ? "yes" : "no"} blocked=${item.blocked ? "yes" : "no"} token=${item.fencingToken ?? "(none)"} commit=${item.commitOk ?? "(n/a)"} renew=${item.renewOk ?? "(n/a)"} release=${item.releaseOk ?? "(n/a)"}`;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
