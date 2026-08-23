import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, type HarnessConfig } from "./config.ts";
import { snapshotDirectory, type FileSnapshot } from "./diff.ts";
import { injectMissingTask500Fault } from "./r01-fault.ts";
import { runFinalVerification, type VerificationResult } from "./verify.ts";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  isWorkspacePresent,
  resolveBaseRevision,
  type Workspace,
} from "./workspace.ts";

export type IsolationProbeResult = {
  taskId: "ISO01";
  taskKind: "mechanism_probe";
  mechanism: "workspace_isolation";
  passed: boolean;
  baseRevision: string;
  workspaceA: Workspace;
  workspaceB: Workspace;
  initiallyEquivalent: boolean;
  mutationObservedInA: boolean;
  mutationAbsentInB: boolean;
  mainCheckoutUnchanged: boolean;
  verifierA: { passed: boolean; exitCode: number };
  verifierB: { passed: boolean; exitCode: number };
  cleanedUp: boolean;
  cleanupRetrySafe: boolean;
  assertions: Record<string, boolean>;
  evidencePath: string;
};

export function runIsolationProbe(): IsolationProbeResult {
  const stamp = timestamp();
  const hostSrc = path.join(REPO_ROOT, "target-app", "src");
  const mainBefore = snapshotDirectory(hostSrc);
  const baseRevision = resolveBaseRevision(REPO_ROOT);
  const tracesDir = path.join(REPO_ROOT, "traces");

  let workspaceA: Workspace | undefined;
  let workspaceB: Workspace | undefined;

  try {
    workspaceA = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `ISO01-A-${stamp}`,
    });
    workspaceB = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `ISO01-B-${stamp}`,
    });

    const sameBase =
      workspaceA.baseRevision === baseRevision &&
      workspaceB.baseRevision === baseRevision;
    const srcA = path.join(workspaceA.root, "target-app", "src");
    const srcB = path.join(workspaceB.root, "target-app", "src");
    const initiallyEquivalent = snapshotsEqual(
      snapshotDirectory(srcA),
      snapshotDirectory(srcB),
    );

    injectMissingTask500Fault(srcA);

    const mutationObservedInA = sourceContainsGetTaskStatus(srcA, 500);
    const mutationAbsentInB = sourceContainsGetTaskStatus(srcB, 404);
    const mainAfterMutation = snapshotDirectory(hostSrc);
    const mainUnchangedAfterMutation = snapshotsEqual(
      mainBefore,
      mainAfterMutation,
    );

    const verifyA = runFinalVerification(verifyConfig(workspaceA, tracesDir));
    const verifyB = runFinalVerification(verifyConfig(workspaceB, tracesDir));

    const assertions: Record<string, boolean> = {
      sameBaseRevision: sameBase,
      initiallyEquivalent,
      mutationObservedInA,
      mutationAbsentInB,
      mainUnchangedAfterMutation,
      verifierAFailed: verifyA.passed === false,
      verifierBPassed: verifyB.passed === true,
    };

    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: workspaceA });
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: workspaceB });
    const cleanedUp =
      !isWorkspacePresent(REPO_ROOT, workspaceA.root) &&
      !isWorkspacePresent(REPO_ROOT, workspaceB.root);

    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: workspaceA });
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: workspaceB });
    const cleanupRetrySafe =
      !isWorkspacePresent(REPO_ROOT, workspaceA.root) &&
      !isWorkspacePresent(REPO_ROOT, workspaceB.root);

    const mainCheckoutUnchanged = snapshotsEqual(
      mainBefore,
      snapshotDirectory(hostSrc),
    );

    assertions.cleanedUp = cleanedUp;
    assertions.cleanupRetrySafe = cleanupRetrySafe;
    assertions.mainCheckoutUnchanged = mainCheckoutUnchanged;

    const passed = Object.values(assertions).every(Boolean);
    const evidencePath = isolationEvidencePath();
    const result: IsolationProbeResult = {
      taskId: "ISO01",
      taskKind: "mechanism_probe",
      mechanism: "workspace_isolation",
      passed,
      baseRevision,
      workspaceA,
      workspaceB,
      initiallyEquivalent,
      mutationObservedInA,
      mutationAbsentInB,
      mainCheckoutUnchanged,
      verifierA: { passed: verifyA.passed, exitCode: verifyA.exitCode },
      verifierB: { passed: verifyB.passed, exitCode: verifyB.exitCode },
      cleanedUp,
      cleanupRetrySafe,
      assertions,
      evidencePath,
    };
    writeIsolationEvidence(result, verifyA, verifyB);
    return result;
  } catch (error) {
    if (workspaceA) {
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: workspaceA });
    }
    if (workspaceB) {
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: workspaceB });
    }
    throw error;
  }
}

export function isExpectedISO01Outcome(result: IsolationProbeResult): boolean {
  return result.passed;
}

export function printIsolationProbeSummary(result: IsolationProbeResult): void {
  console.log("\n=== ISO01 Isolation Probe Summary ===");
  console.log(`base_revision: ${result.baseRevision}`);
  console.log(
    `workspace_a: ${result.workspaceA.id} @ ${result.workspaceA.baseRevision.slice(0, 12)}`,
  );
  console.log(
    `workspace_b: ${result.workspaceB.id} @ ${result.workspaceB.baseRevision.slice(0, 12)}`,
  );
  console.log(
    `initially_equivalent: ${result.initiallyEquivalent ? "yes" : "no"}`,
  );
  console.log(
    `mutation_in_a: ${result.mutationObservedInA ? "yes" : "no"} | absent_in_b: ${result.mutationAbsentInB ? "yes" : "no"}`,
  );
  console.log(
    `main_checkout_unchanged: ${result.mainCheckoutUnchanged ? "yes" : "no"}`,
  );
  console.log(
    `verify_a: ${result.verifierA.passed ? "PASS" : "FAIL"} | verify_b: ${result.verifierB.passed ? "PASS" : "FAIL"}`,
  );
  console.log(
    `cleaned_up: ${result.cleanedUp ? "yes" : "no"} | cleanup_retry_safe: ${result.cleanupRetrySafe ? "yes" : "no"}`,
  );
  console.log(`outcome: ${result.passed ? "expected" : "UNEXPECTED"}`);
  console.log(`evidence: ${result.evidencePath}`);
}

function verifyConfig(workspace: Workspace, tracesDir: string): HarnessConfig {
  return bindConfig(
    {
      apiKey: "unused",
      model: "unused",
      maxTurns: 0,
      maxRepairAttempts: 2,
      maxReviewRepairAttempts: 1,
      repoRoot: REPO_ROOT,
      targetAppRoot: path.join(REPO_ROOT, "target-app"),
      targetSrcRoot: path.join(REPO_ROOT, "target-app", "src"),
      tracesDir,
    },
    workspace,
  );
}

const GET_TASK_404 = `function getTask(service: TaskService, id: string): HttpResponse {
  const task = service.get(id);
  if (!task) {
    return { status: 404, body: { error: "task_not_found" } };
  }`;

const GET_TASK_500 = `function getTask(service: TaskService, id: string): HttpResponse {
  const task = service.get(id);
  if (!task) {
    return { status: 500, body: { error: "task_not_found" } };
  }`;

function sourceContainsGetTaskStatus(
  targetSrcRoot: string,
  status: 404 | 500,
): boolean {
  const routesPath = path.join(targetSrcRoot, "tasks", "task-routes.ts");
  const source = fs.readFileSync(routesPath, "utf8");
  return status === 500
    ? source.includes(GET_TASK_500) && !source.includes(GET_TASK_404)
    : source.includes(GET_TASK_404) && !source.includes(GET_TASK_500);
}

function snapshotsEqual(left: FileSnapshot, right: FileSnapshot): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [rel, content] of left) {
    if (right.get(rel) !== content) {
      return false;
    }
  }
  return true;
}

function isolationEvidencePath(): string {
  const tracesDir = path.join(REPO_ROOT, "traces");
  fs.mkdirSync(tracesDir, { recursive: true });
  return path.join(tracesDir, `ISO01-isolation-${timestamp()}.json`);
}

function writeIsolationEvidence(
  result: IsolationProbeResult,
  verifyA: VerificationResult,
  verifyB: VerificationResult,
): void {
  fs.writeFileSync(
    result.evidencePath,
    `${JSON.stringify(
      {
        ...result,
        verifierA: {
          ...result.verifierA,
          output: verifyA.output,
          durationMs: verifyA.durationMs,
        },
        verifierB: {
          ...result.verifierB,
          output: verifyB.output,
          durationMs: verifyB.durationMs,
        },
      },
      null,
      2,
    )}\n`,
  );
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
