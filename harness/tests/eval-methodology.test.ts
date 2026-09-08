import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { aggregateRuns } from "../src/eval/aggregate.ts";
import { calibrateHoldoutGraders } from "../src/eval/calibrate.ts";
import {
  catalogEntry,
  evaluationRoleOf,
  isExecutableCapabilityTask,
  markHoldoutContaminated,
  taskKindOf,
} from "../src/eval/catalog.ts";
import {
  runIndependentGrader,
  workspaceContainsGraderFiles,
} from "../src/eval/grader.ts";
import { normalizeRun } from "../src/eval/normalize.ts";
import { decideQualification } from "../src/eval/qualify.ts";
import { runQualificationProtocol } from "../src/eval/qualification-run.ts";
import { numericSummary } from "../src/eval/trials.ts";
import {
  CAPABILITY_TASK_IDS,
  HOLDOUT_TASK_IDS,
  QUALIFICATION_CLAIM,
  type RunMetrics,
} from "../src/eval/types.ts";
import { REPO_ROOT } from "../src/config.ts";
import { emptyReviewRunState } from "../src/review.ts";
import type { HarnessRunResult } from "../src/run.ts";
import { executeTool } from "../src/tools.ts";
import type { HarnessConfig } from "../src/config.ts";
import { spawnNpmTest } from "../src/verify.ts";

function discovery() {
  return {
    listFilesCalls: 0,
    readFileCalls: 0,
    readFilePaths: [] as string[],
    listedPaths: [] as string[],
  };
}

function harnessResult(
  overrides: Partial<HarnessRunResult> = {},
): HarnessRunResult {
  return {
    task: "raw task text must not be used as identity",
    workflowStatus: "success",
    specDecision: {
      status: "executable",
      spec: {
        goal: "goal",
        requirements: ["r"],
        constraints: [],
        nonGoals: [],
        acceptance: [],
        verification: ["npm test"],
        ambiguities: [],
      },
    },
    unresolvedQuestions: [],
    implementationStarted: true,
    implementation: null,
    specTurns: 2,
    specModelCalls: 2,
    specToolCalls: 4,
    planningEnabled: false,
    subagentsEnabled: false,
    reviewPlan: null,
    reviewUnits: [],
    reviewabilityReportPath: null,
    reviewUnitGateFailed: false,
    stoppedReviewUnitId: null,
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
      tokenUsage: {
        specInputTokens: 10,
        specOutputTokens: 2,
        implInputTokens: 20,
        implOutputTokens: 4,
        repairInputTokens: 0,
        repairOutputTokens: 0,
        reviewInputTokens: 0,
        reviewOutputTokens: 0,
        reviewRepairInputTokens: 0,
        reviewRepairOutputTokens: 0,
        totalInputTokens: 30,
        totalOutputTokens: 6,
      },
    },
    skillLoads: [],
    workspace: {
      id: "test",
      root: "/tmp/ws",
      baseRevision: "abc123def",
      ref: "HEAD",
    },
    ...overrides,
  };
}

function independentGrader(passed: boolean) {
  return {
    name: "synthetic independent grader",
    passed,
    independentOfHarnessVerify: true as const,
    provenance: "benchmark_owned_independent" as const,
    output: passed ? "ok" : "fail",
    durationMs: 5,
    graderFiles: ["synth.grader.test.ts"],
    stagingDir: "/tmp/grade",
  };
}

function normalizeCapability(taskId: string): RunMetrics {
  return normalizeRun({
    taskId,
    runId: `${taskId}-test`,
    result: harnessResult({
      ...(taskId === "T04"
        ? {
            workflowStatus: "needs_human_judgment" as const,
            implementationStarted: false,
            changedFiles: [],
            verifications: [],
            verificationAttempts: 0,
            finalVerificationPassed: false,
            specDecision: {
              status: "needs_human_judgment",
              spec: {
                goal: "hide",
                requirements: [],
                constraints: [],
                nonGoals: [],
                acceptance: [],
                verification: [],
                ambiguities: [
                  {
                    question: "what?",
                    classification: "requires_human_judgment",
                    status: "unresolved",
                    resolution: "",
                    basis: "underspecified",
                  },
                ],
              },
              unresolvedQuestions: [
                {
                  question: "what?",
                  classification: "requires_human_judgment",
                  status: "unresolved",
                  resolution: "",
                  basis: "underspecified",
                },
              ],
            },
            unresolvedQuestions: [
              {
                question: "what?",
                classification: "requires_human_judgment",
                status: "unresolved",
                resolution: "",
                basis: "underspecified",
              },
            ],
          }
        : {}),
    }),
    expectedOutcomeMet: true,
    configuredModel: "gpt-5.6-luna",
  });
}

function normalizeHoldout(
  taskId: "H01" | "H02",
  trialIndex: number,
  options: { graderPassed: boolean; verifyPassed?: boolean; wall?: number },
): RunMetrics {
  const verifyPassed = options.verifyPassed ?? true;
  return normalizeRun({
    taskId,
    runId: `${taskId}-trial-${trialIndex}`,
    result: harnessResult({
      durationMs: options.wall ?? 1000 * trialIndex,
      modelCalls: 8 + trialIndex,
      toolCalls: 12 + trialIndex,
      finalVerificationPassed: verifyPassed,
      verifications: [
        {
          attempt: 1,
          passed: verifyPassed,
          exitCode: verifyPassed ? 0 : 1,
          durationMs: 8,
          normalizedFailure: null,
        },
      ],
    }),
    expectedOutcomeMet: verifyPassed && options.graderPassed,
    trialIndex,
    trialCount: 3,
    configuredModel: "gpt-5.6-luna",
    independentGrader: independentGrader(options.graderPassed),
  });
}

describe("task catalog classification", () => {
  it("keeps T01–T04 as DEV capability regression and H01/H02 as fresh holdout", () => {
    for (const taskId of CAPABILITY_TASK_IDS) {
      assert.equal(evaluationRoleOf(taskId), "dev");
      assert.equal(taskKindOf(taskId), "capability_regression");
      assert.equal(catalogEntry(taskId)?.inFixedSuite, true);
      assert.equal(catalogEntry(taskId)?.graderIndependentOfHarnessVerify, false);
    }
    assert.equal(isExecutableCapabilityTask("T01"), true);
    assert.equal(isExecutableCapabilityTask("T04"), false);
    for (const taskId of HOLDOUT_TASK_IDS) {
      const entry = catalogEntry(taskId);
      assert.equal(entry?.evaluationRole, "holdout");
      assert.equal(entry?.taskKind, "capability_regression");
      assert.equal(entry?.contaminationStatus, "fresh_holdout");
      assert.equal(entry?.graderIndependentOfHarnessVerify, true);
      assert.equal(entry?.defaultTrialCount, 3);
      assert.equal(entry?.inFixedSuite, false);
    }
    assert.equal(catalogEntry("P01")?.evaluationRole, "dev");
    assert.equal(catalogEntry("P02")?.evaluationRole, "dev");
    assert.equal(catalogEntry("R01")?.evaluationRole, "probe");
    assert.equal(catalogEntry("REV01")?.evaluationRole, "probe");
    assert.equal(catalogEntry("ISO01")?.evaluationRole, "isolation");
    assert.equal(catalogEntry("SEC01")?.evaluationRole, "security");
  });

  it("documents holdout contamination as a catalog lifecycle change, not a silent role flip", () => {
    const contaminated = markHoldoutContaminated("H01");
    assert.equal(contaminated.evaluationRole, "dev");
    assert.equal(contaminated.contaminationStatus, "contaminated_now_dev");
    assert.equal(catalogEntry("H01")?.evaluationRole, "holdout");
    assert.equal(catalogEntry("H01")?.contaminationStatus, "fresh_holdout");
  });
});

describe("escapedDefect and grader provenance", () => {
  it("keeps escapedDefect null without independent ground truth", () => {
    const metrics = normalizeCapability("T01");
    assert.equal(metrics.outcome.escapedDefect, null);
    assert.equal(metrics.outcome.grader.independentOfHarnessVerify, false);
    assert.equal(metrics.outcome.grader.provenance, "harness_verify");
  });

  it("sets escapedDefect true only for VERIFY PASS + independent grader FAIL", () => {
    const escaped = normalizeHoldout("H01", 1, {
      graderPassed: false,
      verifyPassed: true,
    });
    assert.equal(escaped.outcome.escapedDefect, true);
    assert.equal(escaped.outcome.grader.independentOfHarnessVerify, true);
    assert.equal(escaped.outcome.grader.passed, false);
    assert.equal(
      escaped.outcome.grader.provenance,
      "benchmark_owned_independent",
    );
  });

  it("sets escapedDefect false when independent grader PASSes after VERIFY PASS", () => {
    const clean = normalizeHoldout("H01", 1, { graderPassed: true });
    assert.equal(clean.outcome.escapedDefect, false);
    assert.equal(clean.outcome.grader.passed, true);
  });

  it("does not treat VERIFY FAIL as an escaped defect", () => {
    const caught = normalizeHoldout("H02", 1, {
      graderPassed: false,
      verifyPassed: false,
    });
    assert.equal(caught.outcome.escapedDefect, false);
  });
});

describe("repeated-trial aggregation", () => {
  it("reports median and range without replacing raw values", () => {
    const summary = numericSummary([30, 10, 20]);
    assert.equal(summary.median, 20);
    assert.equal(summary.min, 10);
    assert.equal(summary.max, 30);
    assert.deepEqual(summary.values, [30, 10, 20]);
  });

  it("keeps holdout 3/3 as an observed count and records per-trial ids", () => {
    const evalResult = aggregateRuns([
      normalizeHoldout("H01", 1, { graderPassed: true, wall: 1000 }),
      normalizeHoldout("H01", 2, { graderPassed: true, wall: 3000 }),
      normalizeHoldout("H01", 3, { graderPassed: true, wall: 2000 }),
    ]);
    const h01 = evalResult.holdout.tasks[0];
    assert.deepEqual(h01.independentGraderPass, { met: 3, total: 3 });
    assert.equal(h01.efficiency.wallTimeMs.median, 2000);
    assert.equal(h01.efficiency.wallTimeMs.min, 1000);
    assert.equal(h01.efficiency.wallTimeMs.max, 3000);
    assert.deepEqual(h01.trialRunIds, [
      "H01-trial-1",
      "H01-trial-2",
      "H01-trial-3",
    ]);
    assert.match(evalResult.report, /3\/3/);
    assert.doesNotMatch(evalResult.report, /100%/);
    assert.doesNotMatch(evalResult.report, /task success rate/i);
  });
});

describe("no mixing of DEV / HOLDOUT / probe denominators", () => {
  it("keeps T01–T04 capability stats separate from holdout and probes", () => {
    const evalResult = aggregateRuns([
      normalizeCapability("T01"),
      normalizeCapability("T02"),
      normalizeCapability("T03"),
      normalizeCapability("T04"),
      normalizeRun({
        taskId: "R01",
        runId: "R01-test",
        result: harnessResult({
          verificationAttempts: 2,
          repairAttempts: 1,
          verifications: [
            {
              attempt: 1,
              passed: false,
              exitCode: 1,
              durationMs: 8,
              normalizedFailure: null,
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
              modelCalls: 1,
              toolCalls: 1,
              turns: 1,
              receivedTerminalResponse: true,
              changedFiles: ["tasks/task-routes.ts"],
              durationMs: 10,
              tokenUsage: null,
            },
          ],
        }),
        expectedOutcomeMet: true,
      }),
      normalizeHoldout("H01", 1, { graderPassed: true }),
      normalizeHoldout("H01", 2, { graderPassed: true }),
      normalizeHoldout("H01", 3, { graderPassed: false }),
      normalizeHoldout("H02", 1, { graderPassed: true }),
      normalizeHoldout("H02", 2, { graderPassed: true }),
      normalizeHoldout("H02", 3, { graderPassed: true }),
    ]);

    assert.deepEqual(evalResult.capability.expectedOutcomesMet, {
      met: 4,
      total: 4,
    });
    assert.deepEqual(evalResult.capability.firstPassSuccess, {
      met: 3,
      total: 3,
    });
    assert.deepEqual(evalResult.allFixedContracts, { met: 5, total: 5 });
    assert.equal(evalResult.capability.executableTaskCount, 3);
    assert.deepEqual(evalResult.holdout.independentGraderPass, {
      met: 5,
      total: 6,
    });
    assert.equal(
      evalResult.holdout.tasks.find((task) => task.taskId === "H01")
        ?.independentGraderPass.met,
      2,
    );
    assert.equal(evalResult.capability.knownEscapedDefects.count, 0);
    assert.equal(evalResult.holdout.escapedDefects.met, 1);
    assert.match(evalResult.report, /All fixed benchmark contracts\s+5 \/ 5/);
    assert.doesNotMatch(evalResult.report, /task success rate/i);
  });
});

describe("qualification rule", () => {
  it("is frozen before outcomes and treats 2/3 as unsupported, not inconclusive", () => {
    const passing = aggregateRuns([
      normalizeCapability("T01"),
      normalizeCapability("T02"),
      normalizeCapability("T03"),
      normalizeCapability("T04"),
      ...[1, 2, 3].map((trial) =>
        normalizeHoldout("H01", trial, { graderPassed: true }),
      ),
      ...[1, 2, 3].map((trial) =>
        normalizeHoldout("H02", trial, { graderPassed: true }),
      ),
    ]);
    const supported = decideQualification({
      evalResult: passing,
      calibration: { valid: true, reasons: [] },
    });
    assert.equal(supported.claim, QUALIFICATION_CLAIM);
    assert.equal(supported.verdict, "supported");
    assert.equal(supported.claimSupported, true);

    const twoOfThree = aggregateRuns([
      normalizeCapability("T01"),
      normalizeCapability("T02"),
      normalizeCapability("T03"),
      normalizeCapability("T04"),
      normalizeHoldout("H01", 1, { graderPassed: true }),
      normalizeHoldout("H01", 2, { graderPassed: true }),
      normalizeHoldout("H01", 3, {
        graderPassed: false,
        verifyPassed: false,
      }),
      ...[1, 2, 3].map((trial) =>
        normalizeHoldout("H02", trial, { graderPassed: true }),
      ),
    ]);
    const unsupported = decideQualification({
      evalResult: twoOfThree,
      calibration: { valid: true, reasons: [] },
    });
    assert.equal(unsupported.verdict, "unsupported");
    assert.equal(unsupported.claimSupported, false);
    assert.notEqual(unsupported.verdict, "inconclusive");

    const inconclusive = decideQualification({
      evalResult: passing,
      calibration: { valid: false, reasons: ["flaky grader"] },
    });
    assert.equal(inconclusive.verdict, "inconclusive");
    assert.equal(inconclusive.claimSupported, false);
  });

  it("marks T01–T04 failure as regression even if holdout is 3/3", () => {
    const failedT01 = normalizeCapability("T01");
    failedT01.outcome.expectedOutcomeMet = false;
    const evalResult = aggregateRuns([
      failedT01,
      normalizeCapability("T02"),
      normalizeCapability("T03"),
      normalizeCapability("T04"),
      ...[1, 2, 3].map((trial) =>
        normalizeHoldout("H01", trial, { graderPassed: true }),
      ),
      ...[1, 2, 3].map((trial) =>
        normalizeHoldout("H02", trial, { graderPassed: true }),
      ),
    ]);
    const decision = decideQualification({
      evalResult,
      calibration: { valid: true, reasons: [] },
    });
    assert.equal(decision.verdict, "regression");
    assert.equal(decision.claimSupported, false);
  });
});

describe("hidden grader isolation from normal VERIFY", () => {
  it("keeps synthetic grader files out of workspace VERIFY and runs them only independently", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "synth-holdout-"));
    const targetAppRoot = path.join(root, "target-app");
    const graderDir = path.join(root, "grader");
    fs.mkdirSync(path.join(targetAppRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(targetAppRoot, "tests"), { recursive: true });
    fs.mkdirSync(graderDir, { recursive: true });
    copyDir(
      path.join(REPO_ROOT, "benchmarks", "fixtures", "base-src"),
      path.join(targetAppRoot, "src"),
    );
    copyDir(
      path.join(REPO_ROOT, "target-app", "tests"),
      path.join(targetAppRoot, "tests"),
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, "target-app", "package.json"),
      path.join(targetAppRoot, "package.json"),
    );
    fs.symlinkSync(
      path.join(REPO_ROOT, "target-app", "node_modules"),
      path.join(targetAppRoot, "node_modules"),
      "dir",
    );
    fs.writeFileSync(
      path.join(graderDir, "synth.grader.test.ts"),
      [
        'import assert from "node:assert/strict";',
        'import { describe, it } from "node:test";',
        'describe("synthetic hidden grader", () => {',
        '  it("fails unless the workspace marker exists", () => {',
        '    assert.equal(1, 2);',
        "  });",
        "});",
        "",
      ].join("\n"),
    );

    assert.equal(workspaceContainsGraderFiles(targetAppRoot, graderDir), false);
    const verify = spawnNpmTest(targetAppRoot);
    assert.equal(verify.status, 0);
    assert.doesNotMatch(verify.stdout ?? "", /synthetic hidden grader/);

    const grader = runIndependentGrader({
      name: "synthetic independent grader",
      hostGraderDir: graderDir,
      targetAppRoot,
    });
    assert.equal(grader.passed, false);
    assert.match(grader.output, /synthetic hidden grader/);
    assert.equal(workspaceContainsGraderFiles(targetAppRoot, graderDir), false);

    const config: HarnessConfig = {
      apiKey: "test",
      model: "test",
      maxTurns: 20,
      maxRepairAttempts: 2,
      maxReviewRepairAttempts: 1,
      repoRoot: root,
      targetAppRoot,
      targetSrcRoot: path.join(targetAppRoot, "src"),
      tracesDir: path.join(root, "traces"),
    };
    const leakedRead = executeTool(
      config,
      "read_file",
      JSON.stringify({ path: "../grader/synth.grader.test.ts" }),
    );
    assert.equal(leakedRead.ok, false);
    const leakedWrite = executeTool(
      config,
      "write_file",
      JSON.stringify({
        path: "../../grader/synth.grader.test.ts",
        content: "pwned",
      }),
    );
    assert.equal(leakedWrite.ok, false);
    assert.equal(
      fs.readFileSync(path.join(graderDir, "synth.grader.test.ts"), "utf8").includes(
        "pwned",
      ),
      false,
    );
  });
});

describe("grader calibration", () => {
  it("PASSes known-correct H01/H02 implementations and FAILs known defects, stably", () => {
    const report = calibrateHoldoutGraders();
    assert.equal(report.valid, true, report.reasons.join("\n"));
    const correct = report.cases.filter((item) => item.expected === "PASS");
    const defects = report.cases.filter((item) => item.expected === "FAIL");
    assert.ok(correct.length >= 2);
    assert.ok(defects.length >= 4);
    assert.ok(correct.every((item) => item.grader.passed && item.stableRerunPassed));
    assert.ok(defects.every((item) => item.grader.passed === false));
  });
});

describe("qualification protocol wiring", () => {
  it("runs capability once and holdout as independent trials from mocked runners", async () => {
    const result = await runQualificationProtocol({
      configuredModel: "gpt-5.6-luna",
      baseRevision: "abc123def",
      runCapability: async (taskId) =>
        harnessResult({
          tracePath: `/tmp/${taskId}.jsonl`,
          ...(taskId === "T04"
            ? {
                workflowStatus: "needs_human_judgment" as const,
                implementationStarted: false,
                changedFiles: [],
                specDecision: {
                  status: "needs_human_judgment",
                  spec: {
                    goal: "hide",
                    requirements: [],
                    constraints: [],
                    nonGoals: [],
                    acceptance: [],
                    verification: [],
                    ambiguities: [
                      {
                        question: "what?",
                        classification: "requires_human_judgment",
                        status: "unresolved",
                        resolution: "",
                        basis: "underspecified",
                      },
                    ],
                  },
                  unresolvedQuestions: [
                    {
                      question: "what?",
                      classification: "requires_human_judgment",
                      status: "unresolved",
                      resolution: "",
                      basis: "underspecified",
                    },
                  ],
                },
                unresolvedQuestions: [
                  {
                    question: "what?",
                    classification: "requires_human_judgment",
                    status: "unresolved",
                    resolution: "",
                    basis: "underspecified",
                  },
                ],
              }
            : {}),
        }),
      scoreCapability: (taskId, result) =>
        taskId === "T04"
          ? result.workflowStatus === "needs_human_judgment"
          : result.workflowStatus === "success",
      runHoldout: async (taskId, trialIndex) => ({
        result: harnessResult({
          tracePath: `/tmp/${taskId}-${trialIndex}.jsonl`,
        }),
        graderPassed: true,
        graderLeakedIntoWorkspace: false,
        error: null,
      }),
    });
    assert.equal(result.calibration.valid, true);
    assert.equal(result.decision.verdict, "supported");
    assert.deepEqual(result.decision.h01IndependentGrader, {
      met: 3,
      total: 3,
    });
    assert.deepEqual(result.decision.h02IndependentGrader, {
      met: 3,
      total: 3,
    });
    assert.equal(result.eval.capability.expectedOutcomesMet.total, 4);
    assert.equal(result.eval.holdout.tasks.length, 2);
  });
});

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}
