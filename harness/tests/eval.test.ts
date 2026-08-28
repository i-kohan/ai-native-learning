import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateRuns } from "../src/eval/aggregate.ts";
import { normalizeRun } from "../src/eval/normalize.ts";
import {
  CAPABILITY_TASK_IDS,
  type FixedTaskId,
  type RunMetrics,
} from "../src/eval/types.ts";
import { emptyReviewRunState } from "../src/review.ts";
import type { Finding, FindingDecisionRecord } from "../src/review.ts";
import type { IsolationProbeResult } from "../src/iso01.ts";
import type { SecurityProbeResult } from "../src/sec01.ts";
import { scoreExpectedOutcome } from "../src/run-benchmark.ts";
import type { HarnessRunResult } from "../src/run.ts";
import type { Spec } from "../src/spec.ts";
import { normalizeFailure } from "../src/failure.ts";

const FAIL_OUTPUT = `✖ returns 404 when the task does not exist
  AssertionError [ERR_ASSERTION]: 500 !== 404`;

function spec(): Spec {
  return {
    goal: "Keep current task API behavior",
    requirements: ["GET /tasks/:id returns 404 when missing"],
    constraints: ["Do not modify tests"],
    nonGoals: ["New features"],
    acceptance: ["Existing tests pass"],
    verification: ["npm test"],
    ambiguities: [],
  };
}

function discovery() {
  return {
    listFilesCalls: 0,
    readFileCalls: 0,
    readFilePaths: [] as string[],
    listedPaths: [] as string[],
  };
}

function arch01Finding(): Finding {
  return {
    findingKey: "task-state-transition-outside-service",
    category: "architecture",
    severity: "high",
    confidence: "high",
    description:
      "task-routes.ts completeTask mutates Task.status and Task.completedAt instead of delegating to TaskService.",
    evidence: [
      'completeTask calls service.get(id) then assigns task.status = "completed" and task.completedAt',
    ],
    relatedAuthority: {
      type: "architecture_constraint",
      id: "ARCH-01",
    },
  };
}

function namingFinding(): Finding {
  return {
    findingKey: "route-handler-naming",
    category: "maintainability",
    severity: "high",
    confidence: "high",
    description: "completeTask could be named more clearly.",
    evidence: ["function completeTask in task-routes.ts"],
  };
}

function decision(
  finding: Finding,
  kind: FindingDecisionRecord["decision"],
  reason: string,
): FindingDecisionRecord {
  return { finding, decision: kind, reason };
}

function harnessResult(
  overrides: Partial<HarnessRunResult> = {},
): HarnessRunResult {
  return {
    task: "raw task text must not be used as identity",
    workflowStatus: "success",
    specDecision: { status: "executable", spec: spec() },
    unresolvedQuestions: [],
    implementationStarted: true,
    implementation: null,
    specTurns: 2,
    specModelCalls: 2,
    specToolCalls: 4,
    planningEnabled: false,
    subagentsEnabled: false,
    plan: null,
    plannerTurns: 0,
    plannerModelCalls: 0,
    plannerToolCalls: 0,
    plannerDurationMs: 0,
    turns: 6,
    modelCalls: 6,
    toolCalls: 10,
    receivedTerminalResponse: true,
    verificationAttempts: 1,
    repairAttempts: 0,
    repeatedFailure: false,
    verifications: [
      {
        attempt: 1,
        passed: true,
        exitCode: 0,
        durationMs: 8,
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
    tracePath: "/tmp/run.jsonl",
    specPath: "/tmp/run.spec.json",
    durationMs: 1200,
    contextMode: "variant",
    conversationStateMode: "manual",
    clientInputItemsSent: 0,
    clientInputBytesSent: 0,
    contextMetrics: {
      mode: "variant",
      preparation: null,
      specDiscovery: discovery(),
      implDiscovery: discovery(),
      pathOverlap: null,
      implNavCallsBeforeFirstWrite: 0,
      tokenUsage: null,
    },
    skillLoads: [],
    ...overrides,
  };
}

function normalize(
  taskId: FixedTaskId,
  result: HarnessRunResult,
  runId = `${taskId}-test`,
): RunMetrics {
  return normalizeRun({
    taskId,
    runId,
    result,
    expectedOutcomeMet: scoreExpectedOutcome(taskId, result),
  });
}

function t01FirstPass(): HarnessRunResult {
  return harnessResult({
    tracePath: "/tmp/T01-variant.jsonl",
    changedFiles: ["tasks/task-routes.ts"],
  });
}

function t02Recovered(): HarnessRunResult {
  return harnessResult({
    verificationAttempts: 2,
    repairAttempts: 1,
    verifications: [
      {
        attempt: 1,
        passed: false,
        exitCode: 1,
        durationMs: 9,
        normalizedFailure: normalizeFailure({
          passed: false,
          exitCode: 1,
          durationMs: 9,
          output: FAIL_OUTPUT,
        }),
      },
      {
        attempt: 2,
        passed: true,
        exitCode: 0,
        durationMs: 8,
        normalizedFailure: null,
      },
    ],
    repairs: [
      {
        attempt: 1,
        modelCalls: 2,
        toolCalls: 3,
        turns: 2,
        receivedTerminalResponse: true,
        changedFiles: ["tasks/task-service.ts"],
        durationMs: 40,
        tokenUsage: null,
      },
    ],
    tracePath: "/tmp/T02-variant.jsonl",
    changedFiles: ["tasks/task-service.ts"],
  });
}

function t03FirstPass(): HarnessRunResult {
  return harnessResult({
    tracePath: "/tmp/T03-variant.jsonl",
    changedFiles: ["tasks/task-service.ts"],
  });
}

function t04Escalated(): HarnessRunResult {
  const question = {
    question: "What does hide completed when appropriate mean?",
    classification: "requires_human_judgment" as const,
    status: "unresolved" as const,
    resolution: "",
    basis: "task text does not define the default",
  };
  return harnessResult({
    workflowStatus: "needs_human_judgment",
    specDecision: {
      status: "needs_human_judgment",
      spec: {
        ...spec(),
        goal: "Hide completed tasks when appropriate",
        ambiguities: [question],
      },
      unresolvedQuestions: [question],
    },
    unresolvedQuestions: [question],
    implementationStarted: false,
    implementation: null,
    verificationAttempts: 0,
    verifications: [],
    finalVerificationPassed: false,
    receivedTerminalResponse: false,
    changedFiles: [],
    tracePath: "/tmp/T04-variant.jsonl",
  });
}

function r01Probe(): HarnessRunResult {
  return harnessResult({
    verificationAttempts: 2,
    repairAttempts: 1,
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
          output: FAIL_OUTPUT,
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
    changedFiles: [],
    tracePath: "/tmp/R01-repair.jsonl",
    skillLoads: [repairSkillLoad("repair")],
  });
}

function rev01RescuedByVerificationRepair(): HarnessRunResult {
  const ok = rev01Probe();
  return {
    ...ok,
    verificationAttempts: 3,
    repairAttempts: 1,
    verifications: [
      ok.verifications[0],
      {
        attempt: 2,
        passed: false,
        exitCode: 1,
        durationMs: 10,
        normalizedFailure: normalizeFailure({
          passed: false,
          exitCode: 1,
          durationMs: 10,
          output: FAIL_OUTPUT,
        }),
      },
      {
        attempt: 3,
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
  };
}

function rev01Probe(options?: {
  localVerificationNumbering?: boolean;
}): HarnessRunResult {
  const intended = arch01Finding();
  const intendedDecision = decision(
    intended,
    "accepted_blocking",
    "architecture_blocker",
  );
  const secondAttempt = options?.localVerificationNumbering ? 1 : 2;
  return harnessResult({
    verificationAttempts: 2,
    repairAttempts: 0,
    verifications: [
      {
        attempt: 1,
        passed: true,
        exitCode: 0,
        durationMs: 10,
        normalizedFailure: null,
      },
      {
        attempt: secondAttempt,
        passed: true,
        exitCode: 0,
        durationMs: 10,
        normalizedFailure: null,
      },
    ],
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
    intendedFindingDetected: true,
    acceptedBlockingFindings: [intendedDecision],
    blockingFalsePositives: [],
    finalReviewerOutcome: "pass",
    changedFiles: [],
    tracePath: "/tmp/REV01-review.jsonl",
    skillLoads: [repairSkillLoad("review_repair")],
  });
}

function isolationProbe(passed: boolean): IsolationProbeResult {
  const workspace = {
    id: "ISO01-A",
    root: "/tmp/iso01-a",
    baseRevision: "abc123",
    ref: "HEAD",
  };
  return {
    taskId: "ISO01",
    taskKind: "mechanism_probe",
    mechanism: "workspace_isolation",
    passed,
    baseRevision: "abc123",
    workspaceA: workspace,
    workspaceB: { ...workspace, id: "ISO01-B", root: "/tmp/iso01-b" },
    initiallyEquivalent: passed,
    mutationObservedInA: passed,
    mutationAbsentInB: passed,
    mainCheckoutUnchanged: passed,
    verifierA: { passed: false, exitCode: 1 },
    verifierB: { passed: true, exitCode: 0 },
    cleanedUp: passed,
    cleanupRetrySafe: passed,
    assertions: { passed },
    evidencePath: "/tmp/ISO01.json",
  };
}

function securityProbe(passed: boolean): SecurityProbeResult {
  return {
    taskId: "SEC01",
    taskKind: "mechanism_probe",
    mechanism: "verification_secret_isolation",
    passed,
    workspace: {
      id: "SEC01",
      root: "/tmp/sec01",
      baseRevision: "abc123",
      ref: "HEAD",
    },
    parentContainedSentinel: passed,
    probeSourceInjected: passed,
    probeExecuted: passed,
    secretVisibleToChild: !passed,
    verificationPassed: passed,
    sentinelAbsentFromOutput: passed,
    mainCheckoutUnchanged: passed,
    cleanedUp: passed,
    cleanupRetrySafe: passed,
    assertions: { passed },
    evidencePath: "/tmp/SEC01.json",
  };
}

function repairSkillLoad(
  phase: "repair" | "review_repair",
): HarnessRunResult["skillLoads"][number] {
  return {
    skillId: "evidence-guided-repair",
    phase,
    contentHash: "a".repeat(64),
  };
}

function hasGenericPrecisionClaim(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    "falsePositive" in record ||
    "truePositive" in record ||
    "usefulReviewerFinding" in record ||
    "validatedFinding" in record ||
    "reviewerPrecision" in record ||
    "falsePositiveRate" in record
  );
}

describe("RunMetrics normalization", () => {
  it("treats T04 first-pass/eventual/recovered as N/A null, not false", () => {
    const metrics = normalize("T04", t04Escalated());
    assert.equal(metrics.outcome.firstPassSuccess, null);
    assert.equal(metrics.outcome.eventualSuccess, null);
    assert.equal(metrics.outcome.recoveredSuccess, null);
    assert.notEqual(metrics.outcome.firstPassSuccess, false);
    assert.notEqual(metrics.outcome.eventualSuccess, false);
    assert.equal(metrics.outcome.expectedOutcomeMet, true);
    assert.equal(metrics.outcome.autonomousCompletion, false);
    assert.equal(metrics.outcome.humanEscalation, true);
    assert.equal(metrics.identity.taskKind, "capability_regression");
    assert.equal(metrics.identity.taskId, "T04");
    assert.equal(metrics.identity.runId, "T04-test");
  });

  it("labels R01 as a verification-repair mechanism probe", () => {
    const metrics = normalize("R01", r01Probe());
    assert.equal(metrics.identity.taskKind, "mechanism_probe");
    assert.equal(metrics.identity.mechanism, "verification_repair");
    assert.equal(metrics.probe?.mechanism, "verification_repair");
    assert.equal(
      metrics.probe && "controlledFailureTriggered" in metrics.probe,
      true,
    );
    if (metrics.probe?.mechanism === "verification_repair") {
      assert.equal(metrics.probe.controlledFailureTriggered, true);
      assert.equal(metrics.probe.succeeded, true);
    }
  });

  it("uses verification execution order, not raw local attempt numbers", () => {
    const metrics = normalize(
      "REV01",
      rev01Probe({ localVerificationNumbering: true }),
    );
    assert.equal(metrics.recovery.verificationAttempts, 2);
    assert.deepEqual(metrics.recovery.verificationSequence, ["PASS", "PASS"]);
    assert.equal(metrics.recovery.firstVerificationPassed, true);
    assert.equal(metrics.outcome.firstPassSuccess, false);
    assert.equal(metrics.outcome.eventualSuccess, true);
    assert.equal(metrics.outcome.recoveredSuccess, true);
  });

  it("does not treat an accepted reviewer blocker as falsePositive", () => {
    const blocker = decision(namingFinding(), "accepted_blocking", "in_scope");
    const metrics = normalize(
      "T01",
      harnessResult({
        acceptedBlockingFindings: [blocker],
        blockingFalsePositives: [blocker],
        reviews: [
          {
            round: 1,
            status: "findings",
            findings: [namingFinding()],
            decisions: [blocker],
            modelCalls: 1,
            toolCalls: 1,
            durationMs: 12,
            parseOk: true,
            tokenUsage: null,
          },
        ],
        reviewAttempts: 1,
      }),
    );
    assert.equal(metrics.review.acceptedBlocking, 1);
    assert.equal(hasGenericPrecisionClaim(metrics.review), false);
    assert.equal(metrics.probe, undefined);
    assert.equal(metrics.outcome.escapedDefect, null);
  });

  it("does not treat a rejected reviewer finding as falsePositive", () => {
    const rejected = decision(namingFinding(), "rejected", "out_of_scope");
    const metrics = normalize(
      "T01",
      harnessResult({
        rejectedFindings: [rejected],
        reviews: [
          {
            round: 1,
            status: "findings",
            findings: [namingFinding()],
            decisions: [rejected],
            modelCalls: 1,
            toolCalls: 1,
            durationMs: 12,
            parseOk: true,
            tokenUsage: null,
          },
        ],
        reviewAttempts: 1,
      }),
    );
    assert.equal(metrics.review.rejected, 1);
    assert.equal(hasGenericPrecisionClaim(metrics.review), false);
    assert.equal(metrics.probe, undefined);
  });

  it("passes REV01 on PASS→PASS with zero verification repairs", () => {
    const metrics = normalize("REV01", rev01Probe());
    assert.equal(metrics.outcome.expectedOutcomeMet, true);
    assert.deepEqual(metrics.recovery.verificationSequence, ["PASS", "PASS"]);
    assert.equal(metrics.recovery.verificationAttempts, 2);
    assert.equal(metrics.recovery.verificationRepairAttempts, 0);
    if (metrics.probe?.mechanism === "independent_review_repair") {
      assert.equal(metrics.probe.succeeded, true);
    } else {
      assert.fail("REV01 probe metrics missing");
    }
  });

  it("fails REV01 when review repair is rescued by verification repair", () => {
    const metrics = normalize("REV01", rev01RescuedByVerificationRepair());
    assert.equal(metrics.outcome.expectedOutcomeMet, false);
    assert.deepEqual(metrics.recovery.verificationSequence, [
      "PASS",
      "FAIL",
      "PASS",
    ]);
    assert.equal(metrics.recovery.verificationRepairAttempts, 1);
    if (metrics.probe?.mechanism === "independent_review_repair") {
      assert.equal(metrics.probe.succeeded, false);
    } else {
      assert.fail("REV01 probe metrics missing");
    }
  });

  it("records recovered executable success without calling it first-pass", () => {
    const metrics = normalize("T02", t02Recovered());
    assert.equal(metrics.outcome.expectedOutcomeMet, true);
    assert.equal(metrics.outcome.firstPassSuccess, false);
    assert.equal(metrics.outcome.eventualSuccess, true);
    assert.equal(metrics.outcome.recoveredSuccess, true);
    assert.equal(metrics.recovery.firstVerificationPassed, false);
    assert.equal(metrics.recovery.verificationRepairAttempts, 1);
  });
});

describe("EvalResult aggregation", () => {
  const suite = aggregateRuns([
    normalize("T01", t01FirstPass()),
    normalize("T02", t02Recovered()),
    normalize("T03", t03FirstPass()),
    normalize("T04", t04Escalated()),
    normalize("R01", r01Probe()),
    normalize("REV01", rev01Probe()),
  ]);

  it("excludes T04 from the first-pass denominator", () => {
    assert.equal(suite.capability.executableTaskCount, 3);
    assert.deepEqual(suite.capability.firstPassSuccess, { met: 2, total: 3 });
    assert.deepEqual(suite.capability.eventualSuccess, { met: 3, total: 3 });
    assert.deepEqual(suite.capability.recoveredSuccess, { met: 1, total: 3 });
    assert.deepEqual(suite.capability.correctEscalations, { met: 1, total: 1 });
  });

  it("excludes R01/REV01 from capability first-pass statistics", () => {
    assert.equal(
      suite.runs.filter(
        (run) => run.identity.taskKind === "capability_regression",
      ).length,
      4,
    );
    assert.deepEqual(suite.capability.firstPassSuccess, { met: 2, total: 3 });
    assert.equal(suite.probes.R01?.passed, true);
    assert.equal(suite.probes.REV01?.passed, true);
    assert.match(suite.report, /First-pass success\s+2 \/ 3/);
    assert.match(suite.report, /R01 verification repair\s+PASS/);
    assert.match(suite.report, /REV01 independent review\s+PASS/);
    assert.match(suite.report, /All fixed benchmark contracts\s+6 \/ 6/);
    assert.doesNotMatch(suite.report, /task success rate/i);
  });

  it("reports ISO01 separately and keeps V3 contracts at 6/6", () => {
    const withIso = aggregateRuns(
      [
        normalize("T01", t01FirstPass()),
        normalize("T02", t02Recovered()),
        normalize("T03", t03FirstPass()),
        normalize("T04", t04Escalated()),
        normalize("R01", r01Probe()),
        normalize("REV01", rev01Probe()),
      ],
      { isolation: isolationProbe(true) },
    );
    assert.equal(withIso.isolation.ISO01?.mechanism, "workspace_isolation");
    assert.equal(withIso.isolation.ISO01?.passed, true);
    assert.deepEqual(withIso.allFixedContracts, { met: 6, total: 6 });
    assert.deepEqual(withIso.capability.firstPassSuccess, { met: 2, total: 3 });
    assert.deepEqual(withIso.capability.expectedOutcomesMet, {
      met: 4,
      total: 4,
    });
    assert.equal(withIso.capability.executableTaskCount, 3);
    assert.equal(
      withIso.runs.some((run) => run.identity.taskId === "T01"),
      true,
    );
    assert.equal(
      withIso.runs.some((run) => String(run.identity.taskId) === "ISO01"),
      false,
    );
    assert.match(withIso.report, /ISO01 workspace isolation\s+PASS/);
    assert.match(
      withIso.report,
      /not included in capability first-pass \/ task-success/,
    );
    assert.equal(withIso.regressions.length, 0);
  });

  it("reports SEC01 separately and keeps V3 contracts at 6/6", () => {
    const withSec = aggregateRuns(
      [
        normalize("T01", t01FirstPass()),
        normalize("T02", t02Recovered()),
        normalize("T03", t03FirstPass()),
        normalize("T04", t04Escalated()),
        normalize("R01", r01Probe()),
        normalize("REV01", rev01Probe()),
      ],
      { isolation: isolationProbe(true), security: securityProbe(true) },
    );
    assert.equal(
      withSec.security.SEC01?.mechanism,
      "verification_secret_isolation",
    );
    assert.equal(withSec.security.SEC01?.passed, true);
    assert.deepEqual(withSec.allFixedContracts, { met: 6, total: 6 });
    assert.deepEqual(withSec.capability.firstPassSuccess, { met: 2, total: 3 });
    assert.equal(
      withSec.runs.some((run) => String(run.identity.taskId) === "SEC01"),
      false,
    );
    assert.equal(
      (CAPABILITY_TASK_IDS as readonly string[]).includes("SEC01"),
      false,
    );
    assert.match(withSec.report, /SEC01 verification secret isolation\s+PASS/);
    assert.equal(withSec.regressions.length, 0);
  });

  it("treats ISO01 failure as an isolation regression, not a capability miss", () => {
    const failed = aggregateRuns(
      [
        normalize("T01", t01FirstPass()),
        normalize("T02", t02Recovered()),
        normalize("T03", t03FirstPass()),
        normalize("T04", t04Escalated()),
        normalize("R01", r01Probe()),
        normalize("REV01", rev01Probe()),
      ],
      { isolation: isolationProbe(false) },
    );
    assert.equal(failed.isolation.ISO01?.passed, false);
    assert.deepEqual(failed.capability.expectedOutcomesMet, {
      met: 4,
      total: 4,
    });
    assert.deepEqual(failed.capability.firstPassSuccess, { met: 2, total: 3 });
    assert.deepEqual(failed.allFixedContracts, { met: 6, total: 6 });
    assert.ok(
      failed.regressions.some((item) =>
        item.includes("ISO01: workspace-isolation"),
      ),
    );
    assert.equal(
      failed.regressions.some((item) => item.includes("T01")),
      false,
    );
  });

  it("treats SEC01 failure as a security regression, not a capability miss", () => {
    const failed = aggregateRuns(
      [
        normalize("T01", t01FirstPass()),
        normalize("T02", t02Recovered()),
        normalize("T03", t03FirstPass()),
        normalize("T04", t04Escalated()),
        normalize("R01", r01Probe()),
        normalize("REV01", rev01Probe()),
      ],
      { isolation: isolationProbe(true), security: securityProbe(false) },
    );
    assert.equal(failed.security.SEC01?.passed, false);
    assert.deepEqual(failed.capability.expectedOutcomesMet, {
      met: 4,
      total: 4,
    });
    assert.deepEqual(failed.capability.firstPassSuccess, { met: 2, total: 3 });
    assert.deepEqual(failed.allFixedContracts, { met: 6, total: 6 });
    assert.ok(
      failed.regressions.some((item) =>
        item.includes("SEC01: verification-secret-isolation"),
      ),
    );
    assert.equal(
      failed.regressions.some((item) => item.includes("T01")),
      false,
    );
  });

  it("keeps REV01 probe fields out of generic reviewer precision metrics", () => {
    const rev01 = suite.runs.find((run) => run.identity.taskId === "REV01");
    assert.ok(rev01);
    assert.equal(rev01.probe?.mechanism, "independent_review_repair");
    if (rev01.probe?.mechanism === "independent_review_repair") {
      assert.equal(rev01.probe.intendedFindingDetected, true);
      assert.equal(rev01.probe.unexpectedBlockingFindings, 0);
    }
    assert.equal(hasGenericPrecisionClaim(rev01.review), false);
    assert.equal(hasGenericPrecisionClaim(suite.capability), false);
    assert.equal("reviewerPrecision" in suite, false);
    assert.equal(
      suite.capability.knownEscapedDefects.independentGroundTruthRuns,
      0,
    );
  });

  it("keeps the same findingKey in different categories as separate entries", () => {
    const key = "task-state-transition-outside-service";
    const architecture = decision(
      arch01Finding(),
      "accepted_blocking",
      "architecture_blocker",
    );
    const correctnessFinding = {
      ...arch01Finding(),
      category: "correctness" as const,
    };
    const correctness = decision(
      correctnessFinding,
      "rejected",
      "architecture_restated_as_correctness",
    );
    const evalResult = aggregateRuns([
      normalize(
        "T01",
        harnessResult({
          reviewAttempts: 1,
          reviews: [
            {
              round: 1,
              status: "findings",
              findings: [arch01Finding(), correctnessFinding],
              decisions: [architecture, correctness],
              modelCalls: 1,
              toolCalls: 1,
              durationMs: 12,
              parseOk: true,
              tokenUsage: null,
            },
          ],
          acceptedBlockingFindings: [architecture],
          rejectedFindings: [correctness],
        }),
      ),
    ]);
    const entries = evalResult.recurringFindings.filter(
      (item) => item.findingKey === key,
    );
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((item) => item.category).sort(), [
      "architecture",
      "correctness",
    ]);
    assert.equal(
      entries.find((item) => item.category === "architecture")
        ?.acceptedBlocking,
      1,
    );
    assert.equal(
      entries.find((item) => item.category === "correctness")?.rejected,
      1,
    );
  });

  it("treats probe contract failures as hard regressions, recovery as diagnostic", () => {
    const failed = aggregateRuns([
      normalize("T01", t01FirstPass()),
      normalize("T04", t04Escalated()),
      normalize("R01", {
        ...r01Probe(),
        repairAttempts: 0,
        repairs: [],
        verificationAttempts: 1,
        verifications: [
          {
            attempt: 1,
            passed: true,
            exitCode: 0,
            durationMs: 10,
            normalizedFailure: null,
          },
        ],
      }),
    ]);
    assert.ok(failed.regressions.some((item) => item.includes("R01")));
    assert.equal(
      suite.diagnostics.some(
        (item) => item.includes("T02") && item.includes("recovery"),
      ),
      true,
    );
    assert.equal(
      suite.regressions.some((item) => item.includes("T02")),
      false,
    );
  });

  it("records skill loads as diagnostics, not as hard benchmark contracts", () => {
    assert.equal(normalize("T01", t01FirstPass()).skills.loads.length, 0);
    assert.deepEqual(
      normalize("R01", r01Probe()).skills.loads[0]?.phase,
      "repair",
    );
    assert.deepEqual(
      normalize("REV01", rev01Probe()).skills.loads[0]?.phase,
      "review_repair",
    );
    assert.match(suite.report, /Skills/);
    assert.match(suite.report, /T01\s+\(none\)/);
    assert.match(suite.report, /R01\s+evidence-guided-repair@repair/);
    assert.match(suite.report, /REV01 evidence-guided-repair@review_repair/);

    const withSkill = aggregateRuns([normalize("R01", r01Probe())]);
    const withoutSkill = aggregateRuns([
      normalize("R01", { ...r01Probe(), skillLoads: [] }),
    ]);
    assert.equal(withSkill.regressions.length, 0);
    assert.equal(withSkill.diagnostics.length, 0);
    assert.equal(withoutSkill.probes.R01?.passed, true);
    assert.ok(
      withoutSkill.diagnostics.some((item) =>
        item.includes("expected evidence-guided-repair for repair"),
      ),
    );

    const leaked = aggregateRuns([
      normalize(
        "T01",
        harnessResult({
          skillLoads: [repairSkillLoad("repair")],
        }),
      ),
    ]);
    assert.equal(leaked.regressions.length, 0);
    assert.equal(leaked.capability.expectedOutcomesMet.met, 1);
    assert.ok(
      leaked.diagnostics.some((item) => item.includes("unexpected skill load")),
    );
  });
});
