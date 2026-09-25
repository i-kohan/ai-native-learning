import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.ts";
import {
  observeImplementationSurface,
  repositoryScopeOf,
  retrieveWorkerMemory,
} from "./memory.ts";
import { listMemoryRecords, type MemoryRecord } from "./memory-store.ts";
import { isExpectedV1Outcome, runBenchmark } from "./run-benchmark.ts";
import { TOOL_DEFINITIONS } from "./tools.ts";
import { cleanupWorkspace, createWorkspace } from "./workspace.ts";

type TraceLine = {
  event?: string;
  phase?: string;
  tool?: string;
  previous_response_id?: string;
  conversationStateMode?: string;
  memoryHintProvided?: boolean;
  ids?: string[];
  ignoredOutOfScope?: number;
  id?: string;
  bytes?: number;
  tokensEstimate?: number;
  reason?: string;
};

export async function runMem01Probe(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const lessonDir = path.join(
    REPO_ROOT,
    "docs/learning/lessons/24-memory-architectures/traces",
  );
  const storeDir = path.join(lessonDir, `mem01-store-${stamp}`);
  fs.mkdirSync(lessonDir, { recursive: true });
  const scope = repositoryScopeOf(REPO_ROOT);
  const hostObservation = observeImplementationSurface(REPO_ROOT);

  const promotion = await runBenchmark("T02", "variant", {
    conversationStateMode: "manual",
    memory: { storeDir, promote: true },
  });
  const records = listMemoryRecords(storeDir);
  const record = records[0] ?? null;

  const wrongScope =
    record === null
      ? null
      : retrieveWorkerMemory({
          storeDir,
          repositoryScope: "git:example.invalid/other-repo",
          repoRoot: REPO_ROOT,
        });

  const retrieval = await runBenchmark("T03", "variant", {
    conversationStateMode: "manual",
    memory: { storeDir, retrieve: true },
  });

  const promotionTrace = readTrace(promotion.tracePath);
  const retrievalTrace = readTrace(retrieval.tracePath);
  const stale = await runStaleCase(storeDir, stamp);
  const persistedAfterStale = listMemoryRecords(storeDir);

  const discoveryTools = TOOL_DEFINITIONS.map((tool) => tool.name);
  const implTools = retrievalTrace.filter(
    (line) => line.event === "tool_call" && line.phase === "implementation",
  );
  const report = [
    "MEM01 verified repository memory",
    `repository_scope: ${scope}`,
    `host_anchor: ${hostObservation?.anchor ?? "(missing)"}`,
    `host_source: ${hostObservation?.sourcePath ?? "(missing)"}`,
    `host_statement: ${hostObservation?.statement ?? "(missing)"}`,
    "",
    "Process A — T02 promotion",
    `run: ${path.basename(promotion.tracePath)}`,
    `conversation_state_mode: ${promotion.conversationStateMode}`,
    `workflow_status: ${promotion.workflowStatus}`,
    `final_verification: ${promotion.finalVerificationPassed ? "PASS" : "FAIL"}`,
    `review_outcome: ${promotion.finalReviewerOutcome ?? "(none)"}`,
    `expected_t02: ${isExpectedV1Outcome("T02", promotion)}`,
    `memory_candidates: ${promotion.memory?.memoryCandidates ?? 0}`,
    `memory_admitted: ${promotion.memory?.memoryAdmitted ?? 0}`,
    `record_id: ${record?.id ?? "(none)"}`,
    `record_status: ${record?.status ?? "(none)"}`,
    `record_anchor: ${record?.claim.anchor ?? "(none)"}`,
    `record_source: ${record?.sourcePath ?? "(none)"}`,
    `record_statement: ${record?.claim.statement ?? "(none)"}`,
    `record_base_revision: ${record?.baseRevision ?? "(none)"}`,
    `record_run: ${record?.originatingRunId ?? "(none)"}`,
    `record_evidence: ${record ? `${record.evidence.workflowStatus}/${record.evidence.verificationPassed}/${record.evidence.reviewOutcome}` : "(none)"}`,
    `trace: ${promotion.tracePath}`,
    "",
    "Scope filter before Process B",
    `wrong_scope_retrieved: ${wrongScope?.metrics.memoryRetrieved ?? "(skipped)"}`,
    `wrong_scope_ignored: ${wrongScope?.ignoredOutOfScope ?? "(skipped)"}`,
    `wrong_scope_injected: ${wrongScope?.metrics.memoryInjected ?? "(skipped)"}`,
    "",
    "Process B — fresh T03 retrieval",
    `run: ${path.basename(retrieval.tracePath)}`,
    `conversation_state_mode: ${retrieval.conversationStateMode}`,
    `workflow_status: ${retrieval.workflowStatus}`,
    `final_verification: ${retrieval.finalVerificationPassed ? "PASS" : "FAIL"}`,
    `review_outcome: ${retrieval.finalReviewerOutcome ?? "(none)"}`,
    `expected_t03: ${isExpectedV1Outcome("T03", retrieval)}`,
    `memory_retrieved: ${retrieval.memory?.memoryRetrieved ?? 0}`,
    `memory_validated: ${retrieval.memory?.memoryValidated ?? 0}`,
    `memory_rejected_stale: ${retrieval.memory?.memoryRejectedStale ?? 0}`,
    `memory_injected: ${retrieval.memory?.memoryInjected ?? 0}`,
    `injected_bytes: ${retrieval.memory?.injectedBytes ?? 0}`,
    `injected_tokens_estimate: ${retrieval.memory?.injectedTokensEstimate ?? 0}`,
    `impl_nav_before_first_write: ${retrieval.contextMetrics.implNavCallsBeforeFirstWrite ?? "(none)"}`,
    `implementation_list_files: ${countTool(implTools, "list_files")}`,
    `implementation_read_file: ${countTool(implTools, "read_file")}`,
    `previous_response_id_events: ${retrievalTrace.filter((line) => line.previous_response_id).length}`,
    `memory_hint_provided: ${retrievalTrace.some((line) => line.memoryHintProvided === true)}`,
    `trace: ${retrieval.tracePath}`,
    "",
    "Stale isolated workspace",
    `workspace: ${stale.workspaceId}`,
    `retrieved: ${stale.retrieval.metrics.memoryRetrieved}`,
    `validated: ${stale.retrieval.metrics.memoryValidated}`,
    `rejected_stale: ${stale.retrieval.metrics.memoryRejectedStale}`,
    `rejection_reason: ${stale.retrieval.rejectedStale[0]?.reason ?? "(none)"}`,
    `injected: ${stale.retrieval.metrics.memoryInjected}`,
    `hint_present: ${stale.retrieval.hint !== null}`,
    `stored_record_unchanged: ${sameRecord(record, persistedAfterStale[0] ?? null)}`,
    `discovery_tools: ${discoveryTools.filter((name) => name === "list_files" || name === "read_file").join(",")}`,
    "",
    `store: ${storeDir}`,
  ].join("\n");

  const reportPath = path.join(lessonDir, `mem01-${stamp}.txt`);
  fs.writeFileSync(reportPath, `${report}\n`);
  console.log(`\n${report}`);
  console.log(`mem01_report: ${reportPath}`);

  const scopeOk =
    wrongScope !== null &&
    wrongScope.metrics.memoryRetrieved === 0 &&
    wrongScope.ignoredOutOfScope === 1 &&
    wrongScope.metrics.memoryInjected === 0;
  const retrievalMemory = retrieval.memory;
  const retrievalOk =
    retrieval.workflowStatus === "success" &&
    retrieval.finalVerificationPassed === true &&
    retrieval.finalReviewerOutcome === "pass" &&
    retrieval.conversationStateMode === "manual" &&
    retrievalMemory !== undefined &&
    retrievalMemory.memoryRetrieved === 1 &&
    retrievalMemory.memoryValidated === 1 &&
    retrievalMemory.memoryInjected === 1 &&
    retrievalMemory.injectedBytes > 0 &&
    retrievalTrace.some((line) => line.memoryHintProvided === true) &&
    retrievalTrace.every((line) => !line.previous_response_id) &&
    path.basename(promotion.tracePath) !== path.basename(retrieval.tracePath);
  const pass = mem01Pass({
    record,
    hostAnchor: hostObservation?.anchor ?? null,
    hostSource: hostObservation?.sourcePath ?? null,
    promotionOk:
      promotion.workflowStatus === "success" &&
      promotion.finalVerificationPassed === true &&
      promotion.finalReviewerOutcome === "pass" &&
      promotion.conversationStateMode === "manual" &&
      promotion.memory?.memoryAdmitted === 1,
    retrievalOk,
    scopeOk,
    staleOk:
      stale.retrieval.hint === null &&
      stale.retrieval.metrics.memoryRejectedStale === 1 &&
      stale.retrieval.metrics.memoryInjected === 0 &&
      sameRecord(record, persistedAfterStale[0] ?? null) &&
      discoveryTools.includes("list_files") &&
      discoveryTools.includes("read_file"),
  });
  console.log(`mem01: ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}

function mem01Pass(checks: {
  record: MemoryRecord | null;
  hostAnchor: string | null;
  hostSource: string | null;
  promotionOk: boolean;
  retrievalOk: boolean;
  scopeOk: boolean;
  staleOk: boolean;
}): boolean {
  return (
    checks.record?.status === "admitted" &&
    checks.record.kind === "implementation_surface" &&
    checks.record.claim.anchor === "TaskService" &&
    checks.record.sourcePath === "target-app/src/tasks/task-service.ts" &&
    checks.record.claim.anchor === checks.hostAnchor &&
    checks.record.sourcePath === checks.hostSource &&
    checks.record.evidence.verificationPassed === true &&
    checks.record.evidence.reviewOutcome === "pass" &&
    checks.record.evidence.workflowStatus === "success" &&
    checks.promotionOk &&
    checks.retrievalOk &&
    checks.scopeOk &&
    checks.staleOk
  );
}

async function runStaleCase(
  storeDir: string,
  stamp: string,
): Promise<{
  workspaceId: string;
  retrieval: ReturnType<typeof retrieveWorkerMemory>;
}> {
  const workspace = createWorkspace({
    hostRepoRoot: REPO_ROOT,
    id: `mem01-stale-${stamp}`,
  });
  try {
    fs.writeFileSync(
      path.join(workspace.root, "target-app/src/tasks/task-service.ts"),
      "export const removed = true;\n",
    );
    return {
      workspaceId: workspace.id,
      retrieval: retrieveWorkerMemory({
        storeDir,
        repositoryScope: repositoryScopeOf(workspace.root),
        repoRoot: workspace.root,
      }),
    };
  } finally {
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
  }
}

function readTrace(tracePath: string): TraceLine[] {
  return fs
    .readFileSync(tracePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceLine);
}

function countTool(lines: TraceLine[], tool: string): number {
  return lines.filter((line) => line.tool === tool).length;
}

function sameRecord(
  before: MemoryRecord | null,
  after: MemoryRecord | null,
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

const isDirectRun = process.argv[1]?.endsWith("mem01-probe.ts");
if (isDirectRun) {
  runMem01Probe().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
