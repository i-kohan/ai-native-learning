import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  evaluateDecision,
  inspectConversationChain,
  type OrchestrationArmReport,
  type OrchestrationTrialRecord,
} from "../src/orchestration-experiment.ts";

function writeTrace(events: Array<Record<string, unknown>>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-trace-"));
  const file = path.join(dir, "run.jsonl");
  fs.writeFileSync(
    file,
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
  );
  return file;
}

function trial(
  arm: "manual" | "previous_response_id",
  overrides: Partial<OrchestrationTrialRecord["metrics"]> = {},
): OrchestrationTrialRecord {
  return {
    arm,
    attempt: 1,
    runId: `${arm}-1`,
    tracePath: "/tmp/x.jsonl",
    metrics: {
      conversationStateMode: arm,
      expectedOutcomeMet: true,
      workflowStatus: "success",
      finalVerification: "PASS",
      modelCalls: 7,
      toolCalls: 14,
      implementationTurns: 5,
      clientInputItemsSent: arm === "manual" ? 40 : 8,
      clientInputBytesSent: arm === "manual" ? 20000 : 3000,
      inputTokens: 16000,
      outputTokens: 1700,
      wallTimeMs: 25000,
      changedFiles: ["tasks/task-service.ts"],
      chain: {
        calls: [],
        firstTurnHasNoPreviousId: true,
        subsequentTurnsChainPreviousId: true,
        variantSendsOnlyNewItems: arm === "previous_response_id" ? true : null,
        toolCallEvents: 5,
        replayGone: arm === "previous_response_id" ? true : null,
      },
      ...overrides,
    },
  };
}

function arm(
  id: "manual" | "previous_response_id",
  trials: OrchestrationTrialRecord[],
): OrchestrationArmReport {
  return {
    id,
    label: id,
    conversationStateMode: id,
    trials,
    expectedMet: trials.filter((item) => item.metrics.expectedOutcomeMet)
      .length,
    averages: {
      modelCalls: 7,
      toolCalls: 14,
      implementationTurns: 5,
      clientInputItemsSent: id === "manual" ? 40 : 8,
      clientInputBytesSent: id === "manual" ? 20000 : 3000,
      inputTokens: 16000,
      outputTokens: 1700,
      wallTimeMs: 25000,
    },
  };
}

describe("orchestration experiment evidence", () => {
  it("inspects previous_response_id chaining from traces", () => {
    const tracePath = writeTrace([
      {
        event: "model_call_started",
        phase: "implementation",
        turn: 1,
        previousResponseId: null,
        clientInputItemCount: 1,
        clientInputBytes: 20,
      },
      { event: "model_call_completed", turn: 1, responseId: "resp_a" },
      { event: "tool_call", tool: "read_file" },
      {
        event: "model_call_started",
        phase: "implementation",
        turn: 2,
        previousResponseId: "resp_a",
        clientInputItemCount: 2,
        clientInputBytes: 40,
      },
      { event: "model_call_completed", turn: 2, responseId: "resp_b" },
      {
        event: "model_call_started",
        phase: "implementation",
        turn: 3,
        previousResponseId: "resp_b",
        clientInputItemCount: 1,
        clientInputBytes: 15,
      },
      { event: "model_call_completed", turn: 3, responseId: "resp_c" },
    ]);

    const chain = inspectConversationChain(tracePath, "previous_response_id");
    assert.equal(chain.firstTurnHasNoPreviousId, true);
    assert.equal(chain.subsequentTurnsChainPreviousId, true);
    assert.equal(chain.replayGone, true);
    assert.equal(chain.toolCallEvents, 1);
    assert.deepEqual(
      chain.calls.map((call) => call.previousResponseId),
      [null, "resp_a", "resp_b"],
    );
  });

  it("requires 3/3 plus replay reduction before adoption", () => {
    const passed = evaluateDecision(
      arm("manual", [trial("manual"), trial("manual"), trial("manual")]),
      arm("previous_response_id", [
        trial("previous_response_id"),
        trial("previous_response_id"),
        trial("previous_response_id"),
      ]),
    );
    assert.equal(passed.passed, true);

    const failed = evaluateDecision(
      arm("manual", [trial("manual"), trial("manual"), trial("manual")]),
      arm("previous_response_id", [
        trial("previous_response_id", { expectedOutcomeMet: false }),
        trial("previous_response_id"),
        trial("previous_response_id"),
      ]),
    );
    assert.equal(failed.variantCorrect3of3, false);
    assert.equal(failed.passed, false);
  });
});
