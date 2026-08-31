import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { HarnessConfig } from "../src/config.ts";
import { normalizeFailure } from "../src/failure.ts";
import { injectMissingTask500Fault } from "../src/r01-fault.ts";
import { formatRepairContract, nextRepairDecision } from "../src/repair.ts";
import { executeTool } from "../src/tools.ts";
import { emptyReviewRunState } from "../src/review.ts";
import { isExpectedR01Outcome } from "../src/run-benchmark.ts";
import type { HarnessRunResult } from "../src/run.ts";
import type { Spec } from "../src/spec.ts";

const SAMPLE_FAIL_OUTPUT = `> test
> tsx --test tests/**/*.test.ts

▶ GET /tasks/:id
  ✖ returns 404 when the task does not exist (0.382208ms)
✔ GET /tasks/:id (1.046375ms)
ℹ tests 6
ℹ suites 3
ℹ pass 5
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 93.173834

✖ failing tests:

test at tests/tasks.test.ts:6:3
✖ returns 404 when the task does not exist (0.382208ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  500 !== 404

      at TestContext.<anonymous> (/repo/target-app/tests/tasks.test.ts:9:12) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 500,
    expected: 404,
    operator: 'strictEqual'
  }`;

function sampleSpec(): Spec {
  return {
    goal: "Keep missing-task GET returning 404",
    requirements: ["GET /tasks/:id returns 404 when missing"],
    constraints: ["Do not modify tests"],
    nonGoals: ["New features"],
    acceptance: ["Existing not-found test passes"],
    verification: ["npm test"],
    ambiguities: [],
  };
}

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-repair-"));
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(path.join(targetSrcRoot, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(targetAppRoot, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(targetSrcRoot, "app.ts"),
    "export const ok = true;\n",
  );
  fs.writeFileSync(
    path.join(targetAppRoot, "tests", "tasks.test.ts"),
    "test('protected', () => {});\n",
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

describe("failure normalization", () => {
  it("returns compact factual evidence from node:test output", () => {
    const failure = normalizeFailure({
      passed: false,
      exitCode: 1,
      durationMs: 442,
      output: SAMPLE_FAIL_OUTPUT,
    });

    assert.equal(failure.passed, false);
    assert.equal(failure.exitCode, 1);
    assert.equal(failure.durationMs, 442);
    assert.deepEqual(failure.failedTests, [
      "returns 404 when the task does not exist",
    ]);
    assert.ok(failure.locations.some((item) => item.includes("tasks.test.ts")));
    assert.ok(
      failure.assertionMessages.some((item) => item.includes("500 !== 404")),
    );
    assert.equal(failure.summary.tests, 6);
    assert.equal(failure.summary.pass, 5);
    assert.equal(failure.summary.fail, 1);
    assert.match(
      failure.outputPreview,
      /returns 404 when the task does not exist/,
    );
    assert.match(failure.signature, /returns 404 when the task does not exist/);
  });

  it("preserves raw output when structured extraction is incomplete", () => {
    const failure = normalizeFailure({
      passed: false,
      exitCode: 2,
      durationMs: 10,
      output: "npm exploded without a test reporter",
    });
    assert.equal(failure.failedTests.length, 0);
    assert.match(failure.signature, /unstructured/);
    assert.match(failure.outputPreview, /npm exploded/);
  });
});

describe("repair policy", () => {
  it("does not request repair after PASS", () => {
    const decision = nextRepairDecision({
      verificationPassed: true,
      repairAttemptsUsed: 0,
      maxRepairAttempts: 2,
      currentFailureSignature: null,
      previousFailureSignature: null,
      lastRepairChangedFiles: false,
    });
    assert.equal(decision.action, "verified_success");
  });

  it("cannot exceed the configured maximum repair attempts", () => {
    const decision = nextRepairDecision({
      verificationPassed: false,
      repairAttemptsUsed: 2,
      maxRepairAttempts: 2,
      currentFailureSignature: "exit=1 | boom",
      previousFailureSignature: "exit=1 | other",
      lastRepairChangedFiles: true,
    });
    assert.deepEqual(decision, {
      action: "stop",
      reason: "max_repair_attempts",
      repeatedFailure: false,
    });
  });

  it("stops when the same normalized failure repeats with no source change", () => {
    const decision = nextRepairDecision({
      verificationPassed: false,
      repairAttemptsUsed: 1,
      maxRepairAttempts: 2,
      currentFailureSignature: "exit=1 | missing 404",
      previousFailureSignature: "exit=1 | missing 404",
      lastRepairChangedFiles: false,
    });
    assert.deepEqual(decision, {
      action: "stop",
      reason: "repeated_failure",
      repeatedFailure: true,
    });
  });

  it("allows another repair when the failure repeats but source changed", () => {
    const decision = nextRepairDecision({
      verificationPassed: false,
      repairAttemptsUsed: 1,
      maxRepairAttempts: 2,
      currentFailureSignature: "exit=1 | missing 404",
      previousFailureSignature: "exit=1 | missing 404",
      lastRepairChangedFiles: true,
    });
    assert.equal(decision.action, "repair");
    if (decision.action === "repair") {
      assert.equal(decision.attempt, 2);
    }
  });
});

describe("repair capability boundary", () => {
  it("cannot write tests, spec, or files outside target-app/src", () => {
    const config = tempConfig();
    const testsWrite = executeTool(
      config,
      "write_file",
      JSON.stringify({
        path: "../tests/tasks.test.ts",
        content: "hacked",
      }),
    );
    assert.equal(testsWrite.ok, false);
    assert.match(testsWrite.output, /traversal|escapes|not allowed/i);

    const specWrite = executeTool(
      config,
      "write_file",
      JSON.stringify({
        path: "../../docs/learning/progress.md",
        content: "hacked",
      }),
    );
    assert.equal(specWrite.ok, false);

    const srcWrite = executeTool(
      config,
      "write_file",
      JSON.stringify({
        path: "tasks/task-routes.ts",
        content: "export const repaired = true;\n",
      }),
    );
    assert.equal(srcWrite.ok, true);
    assert.equal(
      fs.readFileSync(
        path.join(config.targetSrcRoot, "tasks", "task-routes.ts"),
        "utf8",
      ),
      "export const repaired = true;\n",
    );
    assert.equal(
      fs.readFileSync(
        path.join(config.targetAppRoot, "tests", "tasks.test.ts"),
        "utf8",
      ),
      "test('protected', () => {});\n",
    );
  });

  it("puts the resolved spec and failure evidence in the repair prompt", () => {
    const failure = normalizeFailure({
      passed: false,
      exitCode: 1,
      durationMs: 12,
      output: SAMPLE_FAIL_OUTPUT,
    });
    const prompt = formatRepairContract("raw task text", sampleSpec(), failure);
    assert.match(prompt, /Authoritative specification/);
    assert.match(prompt, /Keep missing-task GET returning 404/);
    assert.match(prompt, /External verification failure/);
    assert.match(prompt, /returns 404 when the task does not exist/);
    assert.match(prompt, /raw task text/);
    assert.doesNotMatch(prompt, /change the status to 404 now/i);
  });
});

describe("R01 fault injection", () => {
  it("injects getTask 404 → 500 once and fails loudly otherwise", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "r01-fault-"));
    const src = path.join(root, "src");
    fs.mkdirSync(path.join(src, "tasks"), { recursive: true });
    const original = fs.readFileSync(
      path.join(
        path.resolve(
          import.meta.dirname,
          "../../benchmarks/fixtures/base-src/tasks/task-routes.ts",
        ),
      ),
      "utf8",
    );
    const routesPath = path.join(src, "tasks", "task-routes.ts");
    fs.writeFileSync(routesPath, original);

    injectMissingTask500Fault(src);
    const injected = fs.readFileSync(routesPath, "utf8");
    assert.match(injected, /function getTask[\s\S]{0,220}status: 500/);
    assert.doesNotMatch(injected, /function getTask[\s\S]{0,220}status: 404/);

    assert.throws(
      () => injectMissingTask500Fault(src),
      /already returns 500|exactly one getTask 404/,
    );
  });
});

describe("R01 expected outcome", () => {
  it("requires FAIL → normalized repair → PASS verified success", () => {
    const ok: HarnessRunResult = {
      task: "R01",
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
      reviewPlan: null,
      reviewUnits: [],
      reviewabilityReportPath: null,
      plan: null,
      plannerTurns: 0,
      plannerModelCalls: 0,
      plannerToolCalls: 0,
      plannerDurationMs: 0,
      turns: 4,
      modelCalls: 4,
      toolCalls: 4,
      receivedTerminalResponse: true,
      verificationAttempts: 2,
      repairAttempts: 1,
      repeatedFailure: false,
      verifications: [
        {
          attempt: 1,
          passed: false,
          exitCode: 1,
          durationMs: 10,
          normalizedFailure: normalizeFailure({
            passed: false,
            exitCode: 1,
            durationMs: 10,
            output: SAMPLE_FAIL_OUTPUT,
          }),
        },
        {
          attempt: 2,
          passed: true,
          exitCode: 0,
          durationMs: 10,
          normalizedFailure: null,
        },
      ],
      repairs: [
        {
          attempt: 1,
          modelCalls: 2,
          toolCalls: 2,
          turns: 2,
          receivedTerminalResponse: true,
          changedFiles: ["tasks/task-routes.ts"],
          durationMs: 20,
          tokenUsage: null,
        },
      ],
      ...emptyReviewRunState(),
      finalVerificationPassed: true,
      finalVerification: null,
      modelFinalResponse: "repaired",
      changedFiles: [],
      unifiedDiff: "",
      tracePath: "/tmp/r01.jsonl",
      specPath: "/tmp/r01.spec.json",
      durationMs: 1,
      contextMode: "variant",
      conversationStateMode: "manual",
      clientInputItemsSent: 0,
      clientInputBytesSent: 0,
      contextMetrics: {
        mode: "variant",
        preparation: null,
        specDiscovery: {
          listFilesCalls: 0,
          readFileCalls: 0,
          readFilePaths: [],
          listedPaths: [],
        },
        implDiscovery: null,
        pathOverlap: null,
        implNavCallsBeforeFirstWrite: null,
        tokenUsage: null,
      },
      skillLoads: [],
    };

    assert.equal(isExpectedR01Outcome(ok), true);
    assert.equal(
      isExpectedR01Outcome({
        ...ok,
        repairAttempts: 2,
        repairs: [ok.repairs[0], ok.repairs[0]],
      }),
      false,
    );
    assert.equal(
      isExpectedR01Outcome({
        ...ok,
        verifications: [
          { ...ok.verifications[0], passed: true, normalizedFailure: null },
          ok.verifications[1],
        ],
      }),
      false,
    );
  });
});
