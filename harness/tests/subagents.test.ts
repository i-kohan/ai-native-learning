import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { HarnessConfig } from "../src/config.ts";
import {
  admitEvidenceReport,
  parseEvidencePayload,
  parseSubmitEvidenceReport,
  shouldEnableSubagents,
  workerToolsForEpisode,
} from "../src/evidence.ts";
import {
  runAgentLoop,
  type ResponsesCreateFn,
  type ResponsesCreateRequest,
  type ResponsesCreateResult,
} from "../src/loop.ts";
import { resolveModel } from "../src/model-routing.ts";
import {
  RESEARCH_CHILD_TOOLS,
  executeResearchTool,
} from "../src/research-subagent.ts";
import {
  evaluateSubagentsDecision,
  type SubagentsArmReport,
  type SubagentsTrialRecord,
} from "../src/subagents-experiment.ts";
import { TOOL_DEFINITIONS } from "../src/tools.ts";

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-subagents-"));
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(targetSrcRoot, { recursive: true });
  fs.writeFileSync(
    path.join(targetSrcRoot, "app.ts"),
    "export const marker = true;\n",
  );
  fs.writeFileSync(path.join(targetAppRoot, "package.json"), "{}\n");
  return {
    apiKey: "test",
    model: "test-model",
    maxTurns: 20,
    maxRepairAttempts: 2,
    maxReviewRepairAttempts: 1,
    repoRoot: root,
    targetAppRoot,
    targetSrcRoot,
    tracesDir: path.join(root, "traces"),
  };
}

function functionCall(callId: string, name: string, args: unknown) {
  return {
    type: "function_call" as const,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
}

function terminal(text: string): ResponsesCreateResult {
  return {
    id: `resp_${text}`,
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    output_text: text,
  };
}

function scriptedCreate(
  script: ResponsesCreateResult[],
): ResponsesCreateFn & { requests: ResponsesCreateRequest[] } {
  const requests: ResponsesCreateRequest[] = [];
  const create: ResponsesCreateFn & { requests: ResponsesCreateRequest[] } =
    Object.assign(
      async (request: ResponsesCreateRequest) => {
        requests.push(request);
        const next = script[requests.length - 1];
        if (!next) {
          throw new Error(
            `unexpected extra Responses call #${requests.length}`,
          );
        }
        return next;
      },
      { requests },
    );
  return create;
}

function validReport(overrides: Record<string, unknown> = {}) {
  return {
    findings: [
      {
        claim: "App exports a marker constant",
        evidencePaths: ["src/app.ts"],
      },
    ],
    inspectedPaths: ["src/app.ts"],
    uncertainties: [],
    ...overrides,
  };
}

function toolNames(request: ResponsesCreateRequest): string[] {
  const tools = request.tools as Array<{ name: string }>;
  return tools.map((tool) => tool.name);
}

describe("subagents default off", () => {
  it("does not expose delegate_research when subagentsEnabled is false", async () => {
    const config = tempConfig();
    const create = scriptedCreate([terminal("done")]);
    await runAgentLoop({
      config,
      task: "inspect app",
      runId: "default-off",
      responsesCreate: create,
    });
    assert.deepEqual(toolNames(create.requests[0]), [
      "list_files",
      "read_file",
      "write_file",
      "run_command",
    ]);
    assert.equal(shouldEnableSubagents(false), false);
    assert.deepEqual(
      workerToolsForEpisode({
        phase: "implementation",
        subagentsEnabled: false,
      }).map((tool) => tool.name),
      TOOL_DEFINITIONS.map((tool) => tool.name),
    );
  });

  it("does not give repair or review_repair the research tool even when enabled", () => {
    for (const phase of ["repair", "review_repair"] as const) {
      const tools = workerToolsForEpisode({
        phase,
        subagentsEnabled: true,
      });
      assert.equal(
        tools.some((tool) => tool.name === "delegate_research"),
        false,
        phase,
      );
    }
  });
});

describe("research child capability restriction", () => {
  it("physically denies write_file, run_command, and delegate_research", () => {
    const config = tempConfig();
    const original = fs.readFileSync(
      path.join(config.targetSrcRoot, "app.ts"),
      "utf8",
    );

    const write = executeResearchTool(
      config,
      "write_file",
      JSON.stringify({ path: "app.ts", content: "hacked" }),
    );
    assert.equal(write.ok, false);
    assert.match(write.output, /not allowed/i);
    assert.equal(
      fs.readFileSync(path.join(config.targetSrcRoot, "app.ts"), "utf8"),
      original,
    );

    const command = executeResearchTool(
      config,
      "run_command",
      JSON.stringify({ command: "npm test" }),
    );
    assert.equal(command.ok, false);
    assert.match(command.output, /not allowed/i);

    const nested = executeResearchTool(
      config,
      "delegate_research",
      JSON.stringify({ objective: "look around", scope: "src" }),
    );
    assert.equal(nested.ok, false);
    assert.match(nested.output, /not allowed/i);

    assert.deepEqual(
      RESEARCH_CHILD_TOOLS.map((tool) => tool.name),
      ["list_files", "read_file", "submit_evidence_report"],
    );
  });
});

describe("EvidenceReport admission", () => {
  it("accepts a valid report and rejects unsafe or malformed payloads", () => {
    const valid = parseSubmitEvidenceReport(JSON.stringify(validReport()));
    assert.equal(valid.ok, true);
    if (valid.ok) {
      assert.match(valid.value.findings[0].claim, /marker/);
    }

    const traversal = parseEvidencePayload(
      validReport({
        findings: [
          {
            claim: "escape",
            evidencePaths: ["../secrets.env"],
          },
        ],
      }),
    );
    assert.equal(traversal.ok, false);
    if (!traversal.ok) {
      assert.match(traversal.error, /traversal/i);
    }

    const missingClaim = parseEvidencePayload({
      findings: [{ evidencePaths: ["src/app.ts"] }],
      inspectedPaths: [],
      uncertainties: [],
    });
    assert.equal(missingClaim.ok, false);
  });
});

describe("EvidenceReport provenance", () => {
  it("accepts a citation of a file the child actually read", () => {
    const parsed = parseEvidencePayload(validReport());
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const admitted = admitEvidenceReport(parsed.value, ["src/app.ts"]);
    assert.equal(admitted.ok, true);
    if (admitted.ok) {
      assert.deepEqual(admitted.value.inspectedPaths, ["src/app.ts"]);
    }
  });

  it("rejects a citation of a file the child never read", () => {
    const parsed = parseEvidencePayload(
      validReport({
        findings: [
          {
            claim: "Other file exists",
            evidencePaths: ["src/other.ts"],
          },
        ],
      }),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const admitted = admitEvidenceReport(parsed.value, ["src/app.ts"]);
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.match(admitted.error, /not read/);
      assert.match(admitted.error, /src\/other\.ts/);
    }
  });

  it("replaces model-supplied inspectedPaths with harness-observed reads", () => {
    const parsed = parseEvidencePayload(
      validReport({ inspectedPaths: ["src/other.ts"] }),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const admitted = admitEvidenceReport(parsed.value, ["src/app.ts"]);
    assert.equal(admitted.ok, true);
    if (admitted.ok) {
      assert.deepEqual(admitted.value.inspectedPaths, ["src/app.ts"]);
      assert.equal(
        admitted.value.findings[0].evidencePaths.includes("src/other.ts"),
        false,
      );
    }
  });

  it("treats equivalent path forms as the same observed read", () => {
    const parsed = parseEvidencePayload(
      validReport({
        findings: [
          {
            claim: "Priority lives on Task",
            evidencePaths: ["target-app/src/tasks/types.ts"],
          },
        ],
        inspectedPaths: ["tasks/types.ts"],
      }),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const admitted = admitEvidenceReport(parsed.value, ["src/tasks/types.ts"]);
    assert.equal(admitted.ok, true);
  });
});

describe("bounded research delegation", () => {
  it("runs the child in the parent workspace and lets the parent continue after a valid report", async () => {
    const config = tempConfig();
    const create = scriptedCreate([
      {
        id: "parent_delegate",
        output: [
          functionCall("d1", "delegate_research", {
            objective: "Where is the marker constant?",
            scope: "src/app.ts",
          }),
        ],
      },
      {
        id: "child_read",
        output: [functionCall("c1", "read_file", { path: "src/app.ts" })],
      },
      {
        id: "child_report",
        output: [functionCall("c2", "submit_evidence_report", validReport())],
      },
      {
        id: "parent_write",
        output: [
          functionCall("w1", "write_file", {
            path: "app.ts",
            content: "export const marker = false;\n",
          }),
        ],
      },
      terminal("implemented"),
    ]);

    const result = await runAgentLoop({
      config,
      task: "change the marker",
      runId: "parent-continues",
      subagentsEnabled: true,
      responsesCreate: create,
    });

    assert.equal(result.researchDelegations.length, 1);
    const delegation = result.researchDelegations[0];
    assert.equal(delegation.outcome, "accepted");
    assert.equal(delegation.workspaceRoot, config.repoRoot);
    assert.ok(delegation.inspectedPaths.readFiles.includes("src/app.ts"));
    assert.deepEqual(delegation.report?.inspectedPaths, ["src/app.ts"]);
    assert.equal(delegation.report?.findings.length, 1);
    assert.match(create.requests[2].instructions, /read-only/i);
    assert.deepEqual(toolNames(create.requests[0]).slice(-1), [
      "delegate_research",
    ]);
    assert.deepEqual(toolNames(create.requests[1]), [
      "list_files",
      "read_file",
      "submit_evidence_report",
    ]);
    const childInput = create.requests[1].input as Array<
      Record<string, unknown>
    >;
    assert.equal(childInput.length, 1);
    assert.match(String(childInput[0].content), /Where is the marker/);
    assert.doesNotMatch(String(childInput[0].content), /change the marker/);
    assert.match(
      JSON.stringify(create.requests[3].input),
      /advisory evidence only/i,
    );
    assert.equal(
      fs.readFileSync(path.join(config.targetSrcRoot, "app.ts"), "utf8"),
      "export const marker = false;\n",
    );
    assert.equal(result.receivedTerminalResponse, true);
    assert.equal(result.modelCalls, 3);
    assert.equal(delegation.childModelCalls, 2);
  });

  it("rejects an unread evidence path and accepts a corrected report", async () => {
    const config = tempConfig();
    const create = scriptedCreate([
      {
        id: "parent_delegate",
        output: [
          functionCall("d1", "delegate_research", {
            objective: "Where is the marker constant?",
            scope: "src/app.ts",
          }),
        ],
      },
      {
        id: "child_read",
        output: [functionCall("c1", "read_file", { path: "src/app.ts" })],
      },
      {
        id: "child_bad_report",
        output: [
          functionCall(
            "c2",
            "submit_evidence_report",
            validReport({
              findings: [
                {
                  claim: "unread file",
                  evidencePaths: ["src/other.ts"],
                },
              ],
              inspectedPaths: ["src/other.ts"],
            }),
          ),
        ],
      },
      {
        id: "child_good_report",
        output: [functionCall("c3", "submit_evidence_report", validReport())],
      },
      terminal("used corrected evidence"),
    ]);

    const result = await runAgentLoop({
      config,
      task: "inspect then implement",
      runId: "unread-citation",
      subagentsEnabled: true,
      responsesCreate: create,
    });

    assert.equal(result.researchDelegations[0]?.outcome, "accepted");
    assert.deepEqual(result.researchDelegations[0]?.report?.inspectedPaths, [
      "src/app.ts",
    ]);
    assert.match(JSON.stringify(create.requests[3].input), /not read/);
    assert.equal(result.receivedTerminalResponse, true);
  });

  it("returns invalid EvidenceReport as a child failure and still continues the parent", async () => {
    const config = tempConfig();
    const create = scriptedCreate([
      {
        id: "parent_delegate",
        output: [
          functionCall("d1", "delegate_research", {
            objective: "inspect types",
            scope: "src",
          }),
        ],
      },
      {
        id: "child_invalid",
        output: [
          functionCall("c1", "submit_evidence_report", {
            findings: [{ claim: "no paths" }],
          }),
        ],
      },
      terminal("still prose"),
      terminal("still prose"),
      terminal("still prose"),
      terminal("still prose"),
      terminal("still prose"),
      terminal("parent continued"),
    ]);

    const result = await runAgentLoop({
      config,
      task: "keep going",
      runId: "invalid-report",
      subagentsEnabled: true,
      responsesCreate: create,
    });

    assert.equal(result.researchDelegations[0]?.outcome, "max_turns_exceeded");
    assert.equal(result.researchDelegations[0]?.report, null);
    assert.equal(result.receivedTerminalResponse, true);
    assert.match(result.modelFinalResponse, /parent continued/);
  });

  it("denies a second delegation in the same Worker episode", async () => {
    const config = tempConfig();
    const create = scriptedCreate([
      {
        id: "parent_first",
        output: [
          functionCall("d1", "delegate_research", {
            objective: "first question",
            scope: "src/app.ts",
          }),
        ],
      },
      {
        id: "child_read",
        output: [functionCall("c0", "read_file", { path: "src/app.ts" })],
      },
      {
        id: "child_report",
        output: [functionCall("c1", "submit_evidence_report", validReport())],
      },
      {
        id: "parent_second",
        output: [
          functionCall("d2", "delegate_research", {
            objective: "second question",
            scope: "src",
          }),
        ],
      },
      terminal("done after denial"),
    ]);

    const result = await runAgentLoop({
      config,
      task: "try twice",
      runId: "second-denied",
      subagentsEnabled: true,
      responsesCreate: create,
    });

    assert.equal(result.researchDelegations.length, 2);
    assert.equal(result.researchDelegations[0].outcome, "accepted");
    assert.equal(result.researchDelegations[1].outcome, "denied_budget");
    assert.equal(result.researchDelegations[1].childModelCalls, 0);
    assert.equal(result.receivedTerminalResponse, true);
    const childRequests = create.requests.filter((request) =>
      toolNames(request).includes("submit_evidence_report"),
    );
    assert.equal(childRequests.length, 2);
  });

  it("uses the same model as the Worker", () => {
    const selected = resolveModel("research", {
      model: "gpt-5.6-luna",
      repairModel: "gpt-5.6-terra",
    });
    assert.equal(selected.model, "gpt-5.6-luna");
    assert.equal(selected.reason, "default");
  });
});

describe("subagents experiment decision rule", () => {
  it("rejects equal quality when variant is clearly more expensive end-to-end", () => {
    const baseline = arm("baseline", { modelCalls: 8, wallTimeMs: 50_000 });
    const variant = arm("variant", { modelCalls: 12, wallTimeMs: 70_000 });
    const decision = evaluateSubagentsDecision(baseline, variant);
    assert.equal(decision.quality, "equal");
    assert.equal(decision.efficiency, "variant_worse");
    assert.equal(decision.conclusion, "reject");
    assert.equal(decision.defaultUnchanged, true);
    assert.match(decision.adoptionStatus, /reject for current workload/);
  });

  it("does not emit candidate from directional e2e improvement without a predefined threshold", () => {
    const baseline = arm("baseline", { modelCalls: 12, wallTimeMs: 70_000 });
    const variant = arm("variant", { modelCalls: 8, wallTimeMs: 50_000 });
    const decision = evaluateSubagentsDecision(baseline, variant);
    assert.equal(decision.quality, "equal");
    assert.equal(decision.efficiency, "variant_better");
    assert.equal(decision.conclusion, "inconclusive");
    assert.match(decision.adoptionStatus, /ROI inconclusive/);
  });
});

function arm(
  id: "baseline" | "variant",
  averages: { modelCalls: number; wallTimeMs: number },
): SubagentsArmReport {
  const trials: SubagentsTrialRecord[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    trials.push({
      arm: id,
      attempt,
      valid: true,
      validity: { valid: true, reason: "valid" },
      runId: `${id}-${attempt}`,
      tracePath: `/tmp/${id}-${attempt}.jsonl`,
      metrics: {
        expectedOutcomeMet: true,
        workflowStatus: "success",
        finalVerification: "PASS",
        firstVerification: "PASS",
        verificationRepairAttempts: 0,
        reviewRepairAttempts: 0,
        acceptedBlockingFindings: 0,
        changedFiles: ["tasks/types.ts"],
        modelCalls: averages.modelCalls,
        toolCalls: 20,
        inputTokens: 20_000,
        outputTokens: 2_000,
        wallTimeMs: averages.wallTimeMs,
        workerModelCalls: 5,
        workerToolCalls: 10,
        workerReadPaths: ["src/app.ts"],
        childModelCalls: id === "variant" ? 2 : 0,
        childToolCalls: id === "variant" ? 3 : 0,
        childInputTokens: id === "variant" ? 1000 : 0,
        childOutputTokens: id === "variant" ? 100 : 0,
        childDurationMs: id === "variant" ? 4000 : 0,
        childInspectedPaths: id === "variant" ? ["src/app.ts"] : [],
        duplicatedReadPaths: id === "variant" ? ["src/app.ts"] : [],
        delegationInvoked: id === "variant",
        delegationCount: id === "variant" ? 1 : 0,
        evidenceReport: null,
        subagentsEnabled: id === "variant",
      },
    });
  }
  return {
    id,
    label: id,
    subagentsEnabled: id === "variant",
    attemptedTrials: 3,
    validTrials: 3,
    expectedMet: 3,
    firstVerificationPass: 3,
    delegationInvoked: id === "variant" ? 3 : 0,
    trials,
    contaminated: [],
    averages: {
      modelCalls: averages.modelCalls,
      toolCalls: 20,
      inputTokens: 20_000,
      outputTokens: 2_000,
      wallTimeMs: averages.wallTimeMs,
      workerModelCalls: 5,
      workerToolCalls: 10,
      childModelCalls: id === "variant" ? 2 : 0,
      childToolCalls: id === "variant" ? 3 : 0,
      verificationRepairAttempts: 0,
      reviewRepairAttempts: 0,
    },
  };
}
