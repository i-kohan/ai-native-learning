import fs from "node:fs";
import path from "node:path";
import { reviewDeltaIdentity } from "./diff.ts";
import { loadConfig } from "./config.ts";
import { printHarnessResult, runV1Harness } from "./run.ts";
import { loadWorkflowState } from "./workflow-store.ts";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const state = loadWorkflowState(args.storeDir, args.workflowId);
  const result = await runV1Harness({
    config,
    task: state.task,
    runId: args.runId,
    contextMode: "variant",
    conversationStateMode: "manual",
    durable: {
      workflowId: args.workflowId,
      storeDir: args.storeDir,
      stopAfter: args.stopAfter,
      injectReviewTransientFailureOnAttempt:
        args.injectReviewTransientFailureOnAttempt,
      stopAfterRetryAdmission: args.stopAfterRetryAdmission,
    },
  });

  const after = loadWorkflowState(args.storeDir, args.workflowId);
  const evidence = {
    workflowId: args.workflowId,
    invocationId: args.runId,
    pid: process.pid,
    ppid: process.ppid,
    phaseOnStart: state.phase,
    phaseOnExit: after.phase,
    stopAfter: args.stopAfter ?? null,
    workflowStatus: result.workflowStatus,
    specDecision: result.specDecision?.status ?? null,
    implementationStarted: result.implementationStarted,
    specModelCalls: result.specModelCalls,
    specToolCalls: result.specToolCalls,
    durableCheckpoint: result.durableCheckpoint ?? null,
    implementationSkipped: result.implementationSkipped === true,
    preReviewVerifySkipped: result.preReviewVerifySkipped === true,
    reviewBaselineRestored: result.reviewBaselineRestored === true,
    reviewAttempts: result.reviewAttempts,
    tracePath: result.tracePath,
    finalVerificationPassed: result.finalVerificationPassed,
    finalReviewerOutcome: result.finalReviewerOutcome,
    workspaceId: result.workspace?.id ?? after.workspace.id,
    workspaceRoot: result.workspace?.root ?? after.workspace.root,
    baseRevision:
      result.workspace?.baseRevision ?? after.workspace.baseRevision,
    retry: after.phase === "review_ready" ? (after.retry ?? null) : null,
    reviewOperationId:
      result.durableRetry?.operationId ??
      (after.phase === "review_ready" ? (after.retry?.operationId ?? null) : null),
    lastRetryDecision: result.lastRetryDecision ?? null,
    ...reviewDeltaIdentity(result.changedFiles, result.unifiedDiff),
  };
  fs.mkdirSync(args.storeDir, { recursive: true });
  fs.writeFileSync(
    invocationEvidencePath(args.storeDir, args.runId),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  printHarnessResult(result);
  if (result.workflowStatus === "failure") {
    process.exit(1);
  }
}

export function invocationEvidencePath(
  storeDir: string,
  runId: string,
): string {
  return path.join(storeDir, `${runId}.invocation.json`);
}

function parseArgs(argv: string[]): {
  workflowId: string;
  storeDir: string;
  runId: string;
  stopAfter?: "implementation_ready" | "review_ready";
  injectReviewTransientFailureOnAttempt?: number;
  stopAfterRetryAdmission?: boolean;
} {
  const workflowId = flagValue(argv, "--workflow-id");
  const storeDir = flagValue(argv, "--store-dir");
  const runId = flagValue(argv, "--run-id");
  const stopAfterRaw = optionalFlagValue(argv, "--stop-after");
  const injectRaw = optionalFlagValue(
    argv,
    "--inject-review-transient-failure-on-attempt",
  );
  if (!workflowId || !storeDir || !runId) {
    throw new Error(
      "Usage: run-durable-invocation --workflow-id ID --store-dir DIR --run-id RUN [--stop-after implementation_ready|review_ready] [--inject-review-transient-failure-on-attempt N] [--stop-after-retry-admission]",
    );
  }
  const stopAfter =
    stopAfterRaw === "implementation_ready" || stopAfterRaw === "review_ready"
      ? stopAfterRaw
      : undefined;
  if (stopAfterRaw && !stopAfter) {
    throw new Error(`Unsupported --stop-after: ${stopAfterRaw}`);
  }
  const injectReviewTransientFailureOnAttempt = injectRaw
    ? Number(injectRaw)
    : undefined;
  if (
    injectRaw &&
    (injectReviewTransientFailureOnAttempt === undefined ||
      !Number.isInteger(injectReviewTransientFailureOnAttempt) ||
      injectReviewTransientFailureOnAttempt < 1)
  ) {
    throw new Error(
      `Unsupported --inject-review-transient-failure-on-attempt: ${injectRaw}`,
    );
  }
  return {
    workflowId,
    storeDir,
    runId,
    stopAfter,
    injectReviewTransientFailureOnAttempt,
    stopAfterRetryAdmission: argv.includes("--stop-after-retry-admission"),
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
  arg.includes("run-durable-invocation.ts"),
);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
