import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.ts";
import { isExpectedV1Outcome, runBenchmark } from "./run-benchmark.ts";
import { A2A_REMOTE_OPENAI_API_KEY_ENV } from "./a2a/constants.ts";

type TraceLine = {
  event?: string;
  phase?: string;
  tool?: string;
  workflowId?: string;
  delegationId?: string;
  taskId?: string | null;
  contextId?: string | null;
  remotePid?: number | null;
  cardDiscovered?: boolean;
  admission?: string;
  sendMessagePerformed?: boolean;
  taskTerminalState?: string | null;
  artifactAdmission?: string;
  outcome?: string;
  grantsWorkflowSuccess?: boolean;
};

export async function runA2a01Probe(): Promise<void> {
  if (!process.env[A2A_REMOTE_OPENAI_API_KEY_ENV]?.trim()) {
    console.error(
      "A2A01 not ran: A2A_REMOTE_OPENAI_API_KEY is not set. The probe does not fall back to OPENAI_API_KEY.",
    );
    process.exit(2);
  }

  const result = await runBenchmark("T01", "variant", {
    a2aDelegationEnabled: true,
  });
  const lines = fs
    .readFileSync(result.tracePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceLine);
  const delegation = lines.find(
    (line) => line.event === "a2a_delegation" && line.delegationId,
  );
  const implTools = lines.filter(
    (line) => line.event === "tool_call" && line.phase === "implementation",
  );
  const delegations = implTools.filter(
    (line) => line.tool === "delegate_remote_analysis",
  );
  const report = [
    "A2A01 bounded DEV probe",
    "task: T01",
    "context: variant",
    `workflow_status: ${result.workflowStatus}`,
    `a2a_delegation_enabled: ${result.a2aDelegationEnabled === true}`,
    `agent_card_discovered: ${delegation?.cardDiscovered === true}`,
    `admission: ${delegation?.admission ?? "(missing)"}`,
    `workflowId: ${delegation?.workflowId ?? "(missing)"}`,
    `delegationId: ${delegation?.delegationId ?? "(missing)"}`,
    `taskId: ${delegation?.taskId ?? "(missing)"}`,
    `contextId: ${delegation?.contextId ?? "(none)"}`,
    `remote_pid: ${delegation?.remotePid ?? "(missing)"}`,
    `send_message: ${delegation?.sendMessagePerformed === true}`,
    `terminal_state: ${delegation?.taskTerminalState ?? "(missing)"}`,
    `artifact: ${delegation?.artifactAdmission ?? "(missing)"}`,
    `delegation_outcome: ${delegation?.outcome ?? "(missing)"}`,
    `delegation_count: ${delegations.length}`,
    `grants_workflow_success: ${delegation?.grantsWorkflowSuccess === true}`,
    `final_verification: ${result.finalVerificationPassed ? "PASS" : "FAIL"}`,
    `review_outcome: ${result.finalReviewerOutcome ?? "(none)"}`,
    `expected_t01: ${isExpectedV1Outcome("T01", result)}`,
    `trace: ${result.tracePath}`,
  ].join("\n");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(
    REPO_ROOT,
    "docs/learning/lessons/25-a2a/traces",
    `a2a01-t01-${stamp}.txt`,
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${report}\n`);
  console.log(`\n${report}`);
  console.log(`a2a01_report: ${reportPath}`);

  const mechanismOk =
    result.a2aDelegationEnabled === true &&
    delegations.length >= 1 &&
    delegation?.cardDiscovered === true &&
    delegation.admission === "pass" &&
    delegation.sendMessagePerformed === true &&
    typeof delegation.taskId === "string" &&
    delegation.taskId.length > 0 &&
    delegation.taskId !== delegation.workflowId &&
    delegation.taskTerminalState === "TASK_STATE_COMPLETED" &&
    delegation.artifactAdmission === "accepted" &&
    delegation.grantsWorkflowSuccess !== true &&
    typeof delegation.remotePid === "number" &&
    delegation.remotePid > 0 &&
    result.finalVerificationPassed === true &&
    result.finalReviewerOutcome === "pass" &&
    isExpectedV1Outcome("T01", result);
  process.exit(mechanismOk ? 0 : 1);
}

const isDirectRun = process.argv[1]?.endsWith("a2a01-probe.ts");
if (isDirectRun) {
  runA2a01Probe().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
