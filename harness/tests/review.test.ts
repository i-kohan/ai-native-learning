import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { HarnessConfig } from "../src/config.ts";
import { REPO_ROOT } from "../src/config.ts";
import {
  ARCH_01,
  decideFinding,
  emptyReviewRunState,
  formatReviewContext,
  formatReviewRepairContract,
  isIntendedArch01Finding,
  nextReviewDecision,
  parseReviewPayload,
  parseSubmitReview,
  shouldStartReview,
  type Finding,
  type ReviewContext,
} from "../src/review.ts";
import { injectArch01CompleteTaskFault } from "../src/rev01-fault.ts";
import { isExpectedREV01Outcome } from "../src/run-benchmark.ts";
import {
  shouldVerifyAfterReviewRepair,
  type HarnessRunResult,
} from "../src/run.ts";
import type { Spec } from "../src/spec.ts";
import { executeTool } from "../src/tools.ts";
import { runFinalVerification } from "../src/verify.ts";

function sampleSpec(): Spec {
  return {
    goal: "Keep complete-task behavior",
    requirements: [
      "POST /tasks/:id/complete marks an existing task completed and sets completedAt",
    ],
    constraints: ["Do not modify tests"],
    nonGoals: ["New features"],
    acceptance: ["Existing complete-task tests pass"],
    verification: ["npm test"],
    ambiguities: [],
  };
}

function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    findingKey: "task-state-transition-outside-service",
    category: "architecture",
    severity: "high",
    confidence: "high",
    description:
      "task-routes.ts completeTask mutates Task.status and Task.completedAt instead of delegating to TaskService.",
    evidence: [
      "completeTask calls service.get(id) then assigns task.status = \"completed\" and task.completedAt",
    ],
    relatedAuthority: {
      type: "architecture_constraint",
      id: "ARCH-01",
    },
    ...overrides,
  };
}

function sampleContext(
  overrides: Partial<ReviewContext> = {},
): ReviewContext {
  return {
    spec: sampleSpec(),
    unifiedDiff: `--- tasks/task-routes.ts\n+++ tasks/task-routes.ts\n-  const task = service.complete(id);\n+  const task = service.get(id);\n+  task.status = "completed";\n+  task.completedAt = new Date().toISOString();`,
    changedFiles: ["tasks/task-routes.ts"],
    architectureConstraints: [ARCH_01],
    verificationEvidence: {
      passed: true,
      exitCode: 0,
      durationMs: 12,
      attempt: 1,
    },
    ...overrides,
  };
}

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-review-"));
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

function intendedReviewResult(): HarnessRunResult {
  const intended = sampleFinding();
  const intendedDecision = decideFinding(intended, sampleContext());
  return {
    task: "REV01",
    workflowStatus: "success",
    specDecision: { status: "executable", spec: sampleSpec() },
    unresolvedQuestions: [],
    implementationStarted: true,
    implementation: null,
    specTurns: 1,
    specModelCalls: 1,
    specToolCalls: 1,
    turns: 6,
    modelCalls: 8,
    toolCalls: 6,
    receivedTerminalResponse: true,
    verificationAttempts: 2,
    repairAttempts: 0,
    repeatedFailure: false,
    verifications: [
      {
        attempt: 1,
        passed: true,
        exitCode: 0,
        durationMs: 10,
        normalizedFailure: null,
      },
      {
        attempt: 2,
        passed: true,
        exitCode: 0,
        durationMs: 10,
        normalizedFailure: null,
      },
    ],
    repairs: [],
    reviewAttempts: 2,
    reviews: [
      {
        round: 1,
        status: "findings",
        findings: [intended],
        decisions: [intendedDecision],
        modelCalls: 1,
        toolCalls: 1,
        durationMs: 20,
        parseOk: true,
        tokenUsage: null,
      },
      {
        round: 2,
        status: "pass",
        findings: [],
        decisions: [],
        modelCalls: 1,
        toolCalls: 1,
        durationMs: 10,
        parseOk: true,
        tokenUsage: null,
      },
    ],
    reviewRepairAttempts: 1,
    reviewRepairs: [
      {
        attempt: 1,
        modelCalls: 2,
        toolCalls: 3,
        turns: 2,
        receivedTerminalResponse: true,
        changedFiles: ["tasks/task-routes.ts"],
        durationMs: 30,
        tokenUsage: null,
      },
    ],
    repeatedFinding: false,
    intendedFindingDetected: true,
    acceptedBlockingFindings: [intendedDecision],
    acceptedNonBlockingFindings: [],
    rejectedFindings: [],
    blockingFalsePositives: [],
    finalReviewerOutcome: "pass",
    finalVerificationPassed: true,
    finalVerification: null,
    modelFinalResponse: "repaired",
    changedFiles: [],
    unifiedDiff: "",
    tracePath: "/tmp/rev01.jsonl",
    specPath: "/tmp/rev01.spec.json",
    durationMs: 1,
    contextMode: "variant",
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
  };
}

describe("structured review parsing", () => {
  it("accepts a valid ReviewResult", () => {
    const parsed = parseSubmitReview(
      JSON.stringify({
        status: "findings",
        findings: [sampleFinding()],
      }),
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.status, "findings");
      assert.equal(parsed.value.findings[0].findingKey, sampleFinding().findingKey);
    }
  });

  it("rejects invalid category, severity, and missing evidence array", () => {
    const category = parseReviewPayload({
      status: "findings",
      findings: [{ ...sampleFinding(), category: "style" }],
    });
    assert.equal(category.ok, false);

    const severity = parseReviewPayload({
      status: "findings",
      findings: [{ ...sampleFinding(), severity: "critical" }],
    });
    assert.equal(severity.ok, false);

    const evidence = parseReviewPayload({
      status: "findings",
      findings: [{ ...sampleFinding(), evidence: "not an array" }],
    });
    assert.equal(evidence.ok, false);
  });

  it("rejects findings status without findings", () => {
    const parsed = parseReviewPayload({ status: "findings", findings: [] });
    assert.equal(parsed.ok, false);
  });

  it("rejects pass status when findings are present", () => {
    const parsed = parseReviewPayload({
      status: "pass",
      findings: [sampleFinding()],
    });
    assert.equal(parsed.ok, false);
  });

  it("accepts pass status only with an empty findings array", () => {
    const parsed = parseReviewPayload({ status: "pass", findings: [] });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.status, "pass");
      assert.equal(parsed.value.findings.length, 0);
    }
  });
});

describe("finding acceptance policy", () => {
  it("accepts a concrete in-scope ARCH-01 finding as blocking", () => {
    const decided = decideFinding(sampleFinding(), sampleContext());
    assert.equal(decided.decision, "accepted_blocking");
    assert.equal(isIntendedArch01Finding(sampleFinding()), true);
  });

  it("records low-severity findings as non-blocking", () => {
    const decided = decideFinding(
      sampleFinding({ severity: "low", findingKey: "naming" }),
      sampleContext(),
    );
    assert.equal(decided.decision, "accepted_non_blocking");
    assert.equal(decided.reason, "low_severity");
  });

  it("may treat an uncovered high-confidence correctness finding as blocking after PASS", () => {
    const decided = decideFinding(
      {
        findingKey: "untested-complete-path-drops-title",
        category: "correctness",
        severity: "high",
        confidence: "high",
        description:
          "tasks/task-routes.ts completeTask returns a body without title on a branch that npm test does not cover.",
        evidence: [
          "In the completeTask success path in tasks/task-routes.ts, the HTTP body is assembled without copying task.title.",
        ],
        relatedAuthority: {
          type: "spec_requirement",
          id: "POST /tasks/:id/complete marks an existing task completed and sets completedAt",
        },
      },
      sampleContext(),
    );
    assert.equal(sampleContext().verificationEvidence.passed, true);
    assert.equal(decided.decision, "accepted_blocking");
  });

  it("does not treat a rejected finding as a repair blocker", () => {
    const rejected = decideFinding(
      sampleFinding({
        findingKey: "invented-rule",
        evidence: [],
        relatedAuthority: undefined,
      }),
      sampleContext(),
    );
    assert.equal(rejected.decision, "rejected");
    const decision = nextReviewDecision({
      reviewRound: 1,
      acceptedBlockingKeys: [],
      previousBlockingKeys: [],
      reviewRepairAttemptsUsed: 0,
      maxReviewRepairAttempts: 1,
    });
    assert.equal(decision.action, "success");
  });

  it("rejects unsupported, out-of-scope, and spec-conflicting findings", () => {
    const unsupported = decideFinding(
      sampleFinding({ evidence: ["   "], relatedAuthority: undefined }),
      sampleContext(),
    );
    assert.equal(unsupported.reason, "unsupported");

    const outOfScope = decideFinding(
      sampleFinding({
        findingKey: "unrelated-file",
        relatedAuthority: undefined,
        description: "Some other module could be cleaner.",
        evidence: ["generic architecture could be cleaner"],
      }),
      sampleContext(),
    );
    assert.equal(outOfScope.reason, "out_of_scope");

    const specConflict = decideFinding(
      sampleFinding({
        findingKey: "invented-requirement",
        category: "correctness",
        relatedAuthority: {
          type: "spec_requirement",
          id: "invented-priority-field",
        },
      }),
      sampleContext(),
    );
    assert.equal(specConflict.reason, "spec_conflict");
  });
});

describe("review repair policy", () => {
  it("caps automatic review repair at 1", () => {
    const decision = nextReviewDecision({
      reviewRound: 1,
      acceptedBlockingKeys: ["task-state-transition-outside-service"],
      previousBlockingKeys: [],
      reviewRepairAttemptsUsed: 1,
      maxReviewRepairAttempts: 1,
    });
    assert.deepEqual(decision, {
      action: "stop",
      reason: "max_review_repair_attempts",
      repeatedFinding: false,
    });
  });

  it("does not allow REVIEW #2 to trigger repair #2", () => {
    const decision = nextReviewDecision({
      reviewRound: 2,
      acceptedBlockingKeys: ["task-state-transition-outside-service"],
      previousBlockingKeys: ["task-state-transition-outside-service"],
      reviewRepairAttemptsUsed: 1,
      maxReviewRepairAttempts: 1,
    });
    assert.equal(decision.action, "stop");
    if (decision.action === "stop") {
      assert.equal(decision.reason, "repeated_finding");
      assert.equal(decision.repeatedFinding, true);
    }
  });

  it("detects a repeated blocking findingKey", () => {
    const decision = nextReviewDecision({
      reviewRound: 2,
      acceptedBlockingKeys: ["same-key"],
      previousBlockingKeys: ["same-key"],
      reviewRepairAttemptsUsed: 1,
      maxReviewRepairAttempts: 1,
    });
    assert.equal(decision.action, "stop");
    if (decision.action === "stop") {
      assert.equal(decision.repeatedFinding, true);
    }
  });

  it("starts the reviewer only after deterministic PASS", () => {
    assert.equal(shouldStartReview(true), true);
    assert.equal(shouldStartReview(false), false);
  });

  it("does not hide a review-repair model_error before re-verification", () => {
    assert.equal(shouldVerifyAfterReviewRepair("model_error"), false);
    assert.equal(shouldVerifyAfterReviewRepair(undefined), true);
    assert.equal(shouldVerifyAfterReviewRepair("max_turns_exceeded"), true);
  });
});

describe("review repair capability boundary", () => {
  it("cannot write tests, spec, verifier, or harness paths", () => {
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
        path.join(config.targetAppRoot, "tests", "tasks.test.ts"),
        "utf8",
      ),
      "test('protected', () => {});\n",
    );
  });

  it("gives repair the spec and accepted findings without a prescribed fix", () => {
    const prompt = formatReviewRepairContract(
      "raw task text",
      sampleSpec(),
      [sampleFinding()],
    );
    assert.match(prompt, /Authoritative specification/);
    assert.match(prompt, /Accepted blocking review findings/);
    assert.match(prompt, /task-state-transition-outside-service/);
    assert.match(prompt, /raw task text/);
    assert.doesNotMatch(prompt, /suggestedFix/);
    assert.doesNotMatch(prompt, /change completeTask to call service.complete now/i);
  });

  it("builds a reviewer context without implementer conversation", () => {
    const prompt = formatReviewContext(sampleContext());
    assert.match(prompt, /Authoritative resolved spec/);
    assert.match(prompt, /ARCH-01/);
    assert.match(prompt, /unified diff/i);
    assert.doesNotMatch(prompt, /implementer justification/i);
    assert.doesNotMatch(prompt, /implementation conversation/i);
  });
});

describe("REV01 fault injection", () => {
  it("injects a route-owned completeTask mutation once", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rev01-fault-"));
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

    injectArch01CompleteTaskFault(src);
    const injected = fs.readFileSync(routesPath, "utf8");
    assert.match(injected, /function completeTask[\s\S]+service\.get\(id\)/);
    assert.match(injected, /task\.status = "completed"/);
    assert.match(injected, /task\.completedAt/);
    assert.doesNotMatch(injected, /service\.complete\(id\)/);

    assert.throws(
      () => injectArch01CompleteTaskFault(src),
      /already mutates Task|exactly one delegated completeTask/,
    );
  });

  it("keeps target-app tests green after injection", () => {
    const original = fs.readFileSync(
      path.join(REPO_ROOT, "target-app/src/tasks/task-routes.ts"),
      "utf8",
    );
    try {
      fs.writeFileSync(
        path.join(REPO_ROOT, "target-app/src/tasks/task-routes.ts"),
        fs.readFileSync(
          path.join(
            REPO_ROOT,
            "benchmarks/fixtures/base-src/tasks/task-routes.ts",
          ),
          "utf8",
        ),
      );
      injectArch01CompleteTaskFault(
        path.join(REPO_ROOT, "target-app/src"),
      );
      const verification = runFinalVerification({
        apiKey: "unused",
        model: "unused",
        maxTurns: 0,
        maxRepairAttempts: 2,
        maxReviewRepairAttempts: 1,
        repoRoot: REPO_ROOT,
        targetAppRoot: path.join(REPO_ROOT, "target-app"),
        targetSrcRoot: path.join(REPO_ROOT, "target-app/src"),
        tracesDir: path.join(REPO_ROOT, "traces"),
      });
      assert.equal(verification.passed, true);
    } finally {
      fs.writeFileSync(
        path.join(REPO_ROOT, "target-app/src/tasks/task-routes.ts"),
        original,
      );
    }
  });
});

describe("REV01 expected outcome", () => {
  it("requires VERIFY PASS → intended ARCH-01 blocker → one review repair → REVIEW #2 pass", () => {
    const ok = intendedReviewResult();
    assert.equal(isExpectedREV01Outcome(ok), true);
    assert.equal(
      isExpectedREV01Outcome({
        ...ok,
        reviewRepairAttempts: 2,
        reviewRepairs: [ok.reviewRepairs[0], ok.reviewRepairs[0]],
      }),
      false,
    );
    assert.equal(
      isExpectedREV01Outcome({
        ...ok,
        verifications: [
          { ...ok.verifications[0], passed: false },
          ok.verifications[1],
        ],
      }),
      false,
    );
    assert.equal(
      isExpectedREV01Outcome({
        ...ok,
        blockingFalsePositives: [
          decideFinding(
            sampleFinding({ findingKey: "other-blocker" }),
            sampleContext(),
          ),
        ],
      }),
      false,
    );
    assert.equal(
      isExpectedREV01Outcome({
        ...emptyReviewRunState(),
        ...ok,
        reviews: [ok.reviews[0]],
        reviewAttempts: 1,
        reviewRepairAttempts: 0,
        reviewRepairs: [],
      }),
      false,
    );
  });
});
