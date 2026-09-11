import fs from "node:fs";
import path from "node:path";
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
    tracePath: result.tracePath,
    finalVerificationPassed: result.finalVerificationPassed,
    finalReviewerOutcome: result.finalReviewerOutcome,
    workspaceId: result.workspace?.id ?? after.workspace.id,
    workspaceRoot: result.workspace?.root ?? after.workspace.root,
    baseRevision: result.workspace?.baseRevision ?? after.workspace.baseRevision,
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

export function invocationEvidencePath(storeDir: string, runId: string): string {
  return path.join(storeDir, `${runId}.invocation.json`);
}

function parseArgs(argv: string[]): {
  workflowId: string;
  storeDir: string;
  runId: string;
  stopAfter?: "implementation_ready";
} {
  const workflowId = flagValue(argv, "--workflow-id");
  const storeDir = flagValue(argv, "--store-dir");
  const runId = flagValue(argv, "--run-id");
  const stopAfterRaw = optionalFlagValue(argv, "--stop-after");
  if (!workflowId || !storeDir || !runId) {
    throw new Error(
      "Usage: run-durable-invocation --workflow-id ID --store-dir DIR --run-id RUN [--stop-after implementation_ready]",
    );
  }
  const stopAfter =
    stopAfterRaw === "implementation_ready" ? "implementation_ready" : undefined;
  if (stopAfterRaw && !stopAfter) {
    throw new Error(`Unsupported --stop-after: ${stopAfterRaw}`);
  }
  return { workflowId, storeDir, runId, stopAfter };
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
