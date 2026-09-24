import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.ts";
import { isExpectedV1Outcome, runBenchmark } from "./run-benchmark.ts";

type TraceLine = {
  event?: string;
  phase?: string;
  tool?: string;
  protocolRevision?: string | null;
  admittedTools?: string[];
  replacedDirectTools?: string[];
};

export async function runMcp01Probe(): Promise<void> {
  const result = await runBenchmark("T01", "variant", {
    mcpRepoReadEnabled: true,
  });
  const lines = fs
    .readFileSync(result.tracePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceLine);

  const admitted = lines.find(
    (line) => line.event === "mcp_repo_read_admitted",
  );
  const implTools = lines.filter(
    (line) => line.event === "tool_call" && line.phase === "implementation",
  );
  const repoReads = implTools.filter((line) => line.tool === "repo_read_file");
  const directReads = implTools.filter((line) => line.tool === "read_file");
  const writes = implTools.filter((line) => line.tool === "write_file");
  const report = [
    "MCP01 bounded DEV probe",
    `task: T01`,
    `context: variant`,
    `workflow_status: ${result.workflowStatus}`,
    `spec: ${result.specDecision?.status ?? "(none)"}`,
    `implementation_started: ${result.implementationStarted}`,
    `mcp_repo_read_enabled: ${result.mcpRepoReadEnabled === true}`,
    `protocol: ${admitted?.protocolRevision ?? "(missing)"}`,
    `admitted_tools: ${(admitted?.admittedTools ?? []).join(",") || "(none)"}`,
    `replaced_direct_tools: ${(admitted?.replacedDirectTools ?? []).join(",") || "(none)"}`,
    `implementation_repo_read_file_calls: ${repoReads.length}`,
    `implementation_read_file_calls: ${directReads.length}`,
    `implementation_write_file_calls: ${writes.length}`,
    `final_verification: ${result.finalVerificationPassed ? "PASS" : "FAIL"}`,
    `review_outcome: ${result.finalReviewerOutcome ?? "(none)"}`,
    `review_attempts: ${result.reviewAttempts}`,
    `expected_t01: ${isExpectedV1Outcome("T01", result)}`,
    `trace: ${result.tracePath}`,
  ].join("\n");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    REPO_ROOT,
    "docs/learning/lessons/23-mcp/traces",
    `mcp01-t01-${stamp}.txt`,
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${report}\n`);
  console.log(`\n${report}`);
  console.log(`mcp01_report: ${reportPath}`);

  const mechanismOk =
    result.mcpRepoReadEnabled === true &&
    admitted?.protocolRevision === "2026-07-28" &&
    repoReads.length > 0 &&
    directReads.length === 0 &&
    writes.length > 0 &&
    result.finalVerificationPassed &&
    result.finalReviewerOutcome === "pass";
  process.exit(mechanismOk ? 0 : 1);
}

const isDirectRun = process.argv[1]?.endsWith("mcp01-probe.ts");
if (isDirectRun) {
  runMcp01Probe().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
