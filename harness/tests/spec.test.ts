import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enforceSpecDecision,
  parseSubmitSpec,
  writeSpecArtifact,
  type Spec,
} from "../src/spec.ts";
import {
  READ_ONLY_TOOL_DEFINITIONS,
  executeReadOnlyTool,
} from "../src/tools.ts";
import type { HarnessConfig } from "../src/config.ts";
import { isExpectedV1Outcome } from "../src/run-benchmark.ts";
import { emptyReviewRunState } from "../src/review.ts";
import type { HarnessRunResult } from "../src/run.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function sampleSpec(overrides: Partial<Spec> = {}): Spec {
  return {
    goal: "Fix missing-task HTTP status",
    requirements: ["GET /tasks/:id returns 404 when missing"],
    constraints: ["Do not modify tests"],
    nonGoals: ["New features"],
    acceptance: ["Existing not-found test passes"],
    verification: ["npm test"],
    ambiguities: [],
    ...overrides,
  };
}

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-spec-"));
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(targetSrcRoot, { recursive: true });
  fs.writeFileSync(
    path.join(targetSrcRoot, "app.ts"),
    "export const ok = true;\n",
  );
  return {
    apiKey: "test",
    model: "test",
    maxTurns: 20,
    maxRepairAttempts: 2,
    maxReviewRepairAttempts: 1,
    repoRoot: root,
    targetAppRoot,
    targetSrcRoot,
    tracesDir: path.join(root, "traces"),
  };
}

describe("spec decision gate", () => {
  it("keeps executable specs executable", () => {
    const decision = enforceSpecDecision({
      status: "executable",
      spec: sampleSpec({
        ambiguities: [
          {
            question: "Helper name",
            classification: "safe_inference",
            status: "resolved",
            resolution: "local private helper is fine",
            basis: "implementation discretion",
          },
        ],
      }),
    });
    assert.equal(decision.status, "executable");
  });

  it("escalates when the model reports needs_human_judgment", () => {
    const decision = enforceSpecDecision({
      status: "needs_human_judgment",
      spec: sampleSpec({
        ambiguities: [
          {
            question: "Should GET /tasks hide completed by default?",
            classification: "requires_human_judgment",
            status: "unresolved",
            resolution: "",
            basis: "task says 'when appropriate'; tests currently return all",
          },
        ],
      }),
    });
    assert.equal(decision.status, "needs_human_judgment");
    if (decision.status !== "needs_human_judgment") {
      return;
    }
    assert.equal(decision.unresolvedQuestions.length, 1);
    assert.match(decision.unresolvedQuestions[0].question, /hide completed/i);
  });

  it("does not trust executable status if a product question is still unresolved", () => {
    const decision = enforceSpecDecision({
      status: "executable",
      spec: sampleSpec({
        requirements: ["GET /tasks returns pending by default"],
        ambiguities: [
          {
            question: "Default list filter",
            classification: "requires_human_judgment",
            status: "unresolved",
            resolution: "",
            basis: "repository does not specify the default",
          },
        ],
      }),
    });
    assert.equal(decision.status, "needs_human_judgment");
  });

  it("parses submit_spec JSON", () => {
    const parsed = parseSubmitSpec(
      JSON.stringify({
        status: "executable",
        spec: sampleSpec(),
      }),
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.value.spec.goal, "Fix missing-task HTTP status");
  });

  it("writes a spec artifact next to the trace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-artifact-"));
    const tracePath = path.join(dir, "T04-run.jsonl");
    const spec = sampleSpec();
    const specPath = writeSpecArtifact(tracePath, {
      task: "hide completed when appropriate",
      decision: "needs_human_judgment",
      spec,
      unresolvedQuestions: [],
      implementationStarted: false,
      workflowStatus: "needs_human_judgment",
    });
    assert.equal(specPath, path.join(dir, "T04-run.spec.json"));
    const saved = JSON.parse(fs.readFileSync(specPath, "utf8")) as {
      decision: string;
      spec: Spec;
    };
    assert.equal(saved.decision, "needs_human_judgment");
    assert.equal(saved.spec.goal, spec.goal);
  });
});

describe("spec phase capability boundary", () => {
  it("does not advertise write_file or run_command to the spec phase", () => {
    const names = READ_ONLY_TOOL_DEFINITIONS.map((tool) => tool.name);
    assert.deepEqual(names, ["list_files", "read_file"]);
  });

  it("rejects write_file even if invoked during spec phase", () => {
    const config = tempConfig();
    const result = executeReadOnlyTool(
      config,
      "write_file",
      JSON.stringify({ path: "app.ts", content: "hacked" }),
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /read-only/i);
    const written = fs.readFileSync(
      path.join(config.targetSrcRoot, "app.ts"),
      "utf8",
    );
    assert.equal(written, "export const ok = true;\n");
  });

  it("rejects run_command during spec phase", () => {
    const result = executeReadOnlyTool(
      tempConfig(),
      "run_command",
      JSON.stringify({ command: "npm test" }),
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /read-only/i);
  });
});

describe("V1 expected outcomes", () => {
  function result(overrides: Partial<HarnessRunResult>): HarnessRunResult {
    return {
      task: "task",
      workflowStatus: "success",
      specDecision: { status: "executable", spec: sampleSpec() },
      unresolvedQuestions: [],
      implementationStarted: true,
      implementation: null,
      specTurns: 1,
      specModelCalls: 1,
      specToolCalls: 1,
      planningEnabled: false,
      subagentsEnabled: false,
      plan: null,
      plannerTurns: 0,
      plannerModelCalls: 0,
      plannerToolCalls: 0,
      plannerDurationMs: 0,
      turns: 2,
      modelCalls: 2,
      toolCalls: 2,
      receivedTerminalResponse: true,
      verificationAttempts: 1,
      repairAttempts: 0,
      repeatedFailure: false,
      verifications: [
        {
          attempt: 1,
          passed: true,
          exitCode: 0,
          durationMs: 1,
          normalizedFailure: null,
        },
      ],
      repairs: [],
      ...emptyReviewRunState(),
      finalVerificationPassed: true,
      finalVerification: null,
      modelFinalResponse: "done",
      changedFiles: ["tasks/task-routes.ts"],
      unifiedDiff: "",
      tracePath: "/tmp/trace.jsonl",
      specPath: "/tmp/trace.spec.json",
      durationMs: 1,
      contextMode: "baseline",
      conversationStateMode: "manual",
      clientInputItemsSent: 0,
      clientInputBytesSent: 0,
      contextMetrics: {
        mode: "baseline",
        preparation: null,
        specDiscovery: {
          listFilesCalls: 0,
          readFileCalls: 0,
          readFilePaths: [],
          listedPaths: [],
        },
        implDiscovery: {
          listFilesCalls: 0,
          readFileCalls: 0,
          readFilePaths: [],
          listedPaths: [],
        },
        pathOverlap: {
          readFileOverlap: [],
          listedPathOverlap: [],
        },
        implNavCallsBeforeFirstWrite: 0,
        tokenUsage: null,
      },
      skillLoads: [],
      ...overrides,
    };
  }

  it("expects T01–T03 to be executable successes", () => {
    const ok = result({});
    assert.equal(isExpectedV1Outcome("T01", ok), true);
    assert.equal(isExpectedV1Outcome("T02", ok), true);
    assert.equal(isExpectedV1Outcome("T03", ok), true);
  });

  it("expects T04 to escalate without implementation or source changes", () => {
    const unresolved = [
      {
        question: "When should completed tasks be hidden?",
        classification: "requires_human_judgment" as const,
        status: "unresolved" as const,
        resolution: "",
        basis: "task does not specify the rule",
      },
    ];
    const t04 = result({
      workflowStatus: "needs_human_judgment",
      specDecision: {
        status: "needs_human_judgment",
        spec: sampleSpec({ ambiguities: unresolved }),
        unresolvedQuestions: unresolved,
      },
      unresolvedQuestions: unresolved,
      implementationStarted: false,
      finalVerificationPassed: false,
      changedFiles: [],
    });
    assert.equal(isExpectedV1Outcome("T04", t04), true);
    assert.equal(
      isExpectedV1Outcome(
        "T04",
        result({
          workflowStatus: "needs_human_judgment",
          specDecision: {
            status: "needs_human_judgment",
            spec: sampleSpec(),
            unresolvedQuestions: [],
          },
          unresolvedQuestions: [],
          implementationStarted: false,
          changedFiles: [],
        }),
      ),
      false,
    );
    assert.equal(
      isExpectedV1Outcome(
        "T04",
        result({
          workflowStatus: "success",
          implementationStarted: true,
        }),
      ),
      false,
    );
  });
});
