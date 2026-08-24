import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, type HarnessConfig } from "./config.ts";
import { snapshotDirectory, type FileSnapshot } from "./diff.ts";
import { runFinalVerification, type VerificationResult } from "./verify.ts";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  isWorkspacePresent,
  type Workspace,
} from "./workspace.ts";

export const SEC01_SENTINEL_NAME = "SEC01_SECRET";
export const SEC01_PROBE_EXECUTED = "SEC01_PROBE_EXECUTED";
export const SEC01_SECRET_VISIBLE = "SEC01_SECRET_VISIBLE";

const SEC01_SENTINEL_VALUE = "sec01-controlled-canary";

export type SecurityProbeResult = {
  taskId: "SEC01";
  taskKind: "mechanism_probe";
  mechanism: "verification_secret_isolation";
  passed: boolean;
  workspace: Workspace;
  parentContainedSentinel: boolean;
  probeSourceInjected: boolean;
  probeExecuted: boolean;
  secretVisibleToChild: boolean;
  verificationPassed: boolean;
  sentinelAbsentFromOutput: boolean;
  mainCheckoutUnchanged: boolean;
  cleanedUp: boolean;
  cleanupRetrySafe: boolean;
  assertions: Record<string, boolean>;
  evidencePath: string;
};

export function runSecurityProbe(): SecurityProbeResult {
  const stamp = timestamp();
  const hostSrc = path.join(REPO_ROOT, "target-app", "src");
  const mainBefore = snapshotDirectory(hostSrc);
  const tracesDir = path.join(REPO_ROOT, "traces");
  const previousSentinel = process.env[SEC01_SENTINEL_NAME];
  process.env[SEC01_SENTINEL_NAME] = SEC01_SENTINEL_VALUE;

  let workspace: Workspace | undefined;

  try {
    workspace = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `SEC01-${stamp}`,
    });

    const targetSrcRoot = path.join(workspace.root, "target-app", "src");
    injectSec01Probe(targetSrcRoot);
    const probeSourceInjected = sourceContainsSec01Probe(targetSrcRoot);
    const parentContainedSentinel =
      process.env[SEC01_SENTINEL_NAME] === SEC01_SENTINEL_VALUE;

    const verification = runFinalVerification(
      verifyConfig(workspace, tracesDir),
    );
    const probeExecuted = verification.output.includes(SEC01_PROBE_EXECUTED);
    const secretVisibleToChild =
      verification.output.includes(SEC01_SECRET_VISIBLE);
    const sentinelAbsentFromOutput =
      !verification.output.includes(SEC01_SENTINEL_VALUE);

    const assertions: Record<string, boolean> = {
      parentContainedSentinel,
      probeSourceInjected,
      probeExecuted,
      secretNotVisibleToChild: !secretVisibleToChild,
      verificationPassed: verification.passed,
      sentinelAbsentFromOutput,
    };

    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
    const cleanedUp = !isWorkspacePresent(REPO_ROOT, workspace.root);
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
    const cleanupRetrySafe = !isWorkspacePresent(REPO_ROOT, workspace.root);
    const mainCheckoutUnchanged = snapshotsEqual(
      mainBefore,
      snapshotDirectory(hostSrc),
    );

    assertions.cleanedUp = cleanedUp;
    assertions.cleanupRetrySafe = cleanupRetrySafe;
    assertions.mainCheckoutUnchanged = mainCheckoutUnchanged;

    const passed = Object.values(assertions).every(Boolean);
    const evidencePath = securityEvidencePath();
    const result: SecurityProbeResult = {
      taskId: "SEC01",
      taskKind: "mechanism_probe",
      mechanism: "verification_secret_isolation",
      passed,
      workspace,
      parentContainedSentinel,
      probeSourceInjected,
      probeExecuted,
      secretVisibleToChild,
      verificationPassed: verification.passed,
      sentinelAbsentFromOutput,
      mainCheckoutUnchanged,
      cleanedUp,
      cleanupRetrySafe,
      assertions,
      evidencePath,
    };
    writeSecurityEvidence(result, verification);
    return result;
  } catch (error) {
    if (workspace) {
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
    }
    throw error;
  } finally {
    restoreSentinel(previousSentinel);
  }
}

export function isExpectedSEC01Outcome(result: SecurityProbeResult): boolean {
  return result.passed;
}

export function printSecurityProbeSummary(result: SecurityProbeResult): void {
  console.log("\n=== SEC01 Security Probe Summary ===");
  console.log(`workspace: ${result.workspace.id}`);
  console.log(
    `parent_contained_sentinel: ${result.parentContainedSentinel ? "yes" : "no"}`,
  );
  console.log(
    `probe_executed: ${result.probeExecuted ? "yes" : "no"} | source_injected: ${result.probeSourceInjected ? "yes" : "no"}`,
  );
  console.log(
    `secret_visible_to_child: ${result.secretVisibleToChild ? "yes" : "no"}`,
  );
  console.log(`verification: ${result.verificationPassed ? "PASS" : "FAIL"}`);
  console.log(
    `sentinel_absent_from_output: ${result.sentinelAbsentFromOutput ? "yes" : "no"}`,
  );
  console.log(
    `main_checkout_unchanged: ${result.mainCheckoutUnchanged ? "yes" : "no"}`,
  );
  console.log(
    `cleaned_up: ${result.cleanedUp ? "yes" : "no"} | cleanup_retry_safe: ${result.cleanupRetrySafe ? "yes" : "no"}`,
  );
  console.log(`outcome: ${result.passed ? "expected" : "UNEXPECTED"}`);
  console.log(`evidence: ${result.evidencePath}`);
}

function injectSec01Probe(targetSrcRoot: string): void {
  const appPath = path.join(targetSrcRoot, "app.ts");
  if (!fs.existsSync(appPath)) {
    throw new Error(`SEC01 probe injection failed: missing ${appPath}`);
  }
  const source = fs.readFileSync(appPath, "utf8");
  if (source.includes(SEC01_PROBE_EXECUTED)) {
    throw new Error(
      "SEC01 probe injection failed: probe marker already present.",
    );
  }
  fs.writeFileSync(appPath, `${SEC01_PROBE_SOURCE}${source}`, "utf8");
}

function sourceContainsSec01Probe(targetSrcRoot: string): boolean {
  const source = fs.readFileSync(path.join(targetSrcRoot, "app.ts"), "utf8");
  return (
    source.includes(SEC01_PROBE_EXECUTED) &&
    source.includes(SEC01_SECRET_VISIBLE) &&
    !source.includes(SEC01_SENTINEL_VALUE)
  );
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

function restoreSentinel(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[SEC01_SENTINEL_NAME];
    return;
  }
  process.env[SEC01_SENTINEL_NAME] = previous;
}

function securityEvidencePath(): string {
  const tracesDir = path.join(REPO_ROOT, "traces");
  fs.mkdirSync(tracesDir, { recursive: true });
  return path.join(tracesDir, `SEC01-secret-isolation-${timestamp()}.json`);
}

function writeSecurityEvidence(
  result: SecurityProbeResult,
  verification: VerificationResult,
): void {
  fs.writeFileSync(
    result.evidencePath,
    `${JSON.stringify(
      {
        ...result,
        verification: {
          passed: verification.passed,
          exitCode: verification.exitCode,
          durationMs: verification.durationMs,
          output: redactSentinel(verification.output),
        },
      },
      null,
      2,
    )}\n`,
  );
}

function redactSentinel(text: string): string {
  return text.split(SEC01_SENTINEL_VALUE).join("[redacted-sentinel]");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const SEC01_PROBE_SOURCE = `console.error(${JSON.stringify(SEC01_PROBE_EXECUTED)});
if (Object.hasOwn(process.env, ${JSON.stringify(SEC01_SENTINEL_NAME)})) {
  throw new Error(${JSON.stringify(SEC01_SECRET_VISIBLE)});
}

`;
