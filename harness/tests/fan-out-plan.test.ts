import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  admitFanOutPlan,
  FAN_OUT_MAX_PARALLEL_WORKERS,
  FAN_OUT_PLAN_RULE,
  FAN_OUT_UNIT_SCOPE_RULE,
  type FanOutPlan,
  fanOutUnitExecutionScope,
  formatWorkerFanOutUnitTask,
  parseFanOutPlanPayload,
} from "../src/fan-out-plan.ts";
import {
  assessFanOutTrialValidity,
  bindP03FanOutPlan,
  evaluatePar01Decision,
  type FanOutArmReport,
  type FanOutTrialRecord,
  metricsFromP03Run,
  PAR01_DECISION_RULE,
  runFanOutExperiment,
} from "../src/fanout-experiment.ts";
import type { HarnessRunResult } from "../src/run.ts";
import type { Spec } from "../src/spec.ts";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function startedResult(
  base: string,
  schedule: "sequential" | "parallel",
): HarnessRunResult {
  return {
    specDecision: { status: "executable", spec: sampleSpec([]) },
    workflowStatus: "success",
    implementationStarted: true,
    finalVerificationPassed: true,
    finalReviewerOutcome: "pass",
    repairAttempts: 0,
    reviewRepairAttempts: 0,
    modelCalls: 0,
    toolCalls: 0,
    changedFiles: [],
    durationMs: 10,
    contextMetrics: { tokenUsage: null },
    verifications: [],
    reviews: [],
    fanOut: {
      schedule,
      plan: { baseRevision: base },
      provenance: {
        baseRevision: base,
        childRevisions: { A: base, B: base },
        integrationRevision: base,
        exactBase: true,
      },
      children: [
        {
          unitId: "A",
          startedAt: 10,
          baseRevision: base,
          durationMs: 1,
          modelCalls: 1,
          toolCalls: 1,
          tokenUsage: null,
          changedFiles: [],
          verificationPassed: true,
          repairAttempts: 0,
        },
        {
          unitId: "B",
          startedAt: 11,
          baseRevision: base,
          durationMs: 1,
          modelCalls: 1,
          toolCalls: 1,
          tokenUsage: null,
          changedFiles: [],
          verificationPassed: true,
          repairAttempts: 0,
        },
      ],
      fanIn: { ok: true, durationMs: 1, conflict: null, lostChanges: [] },
      writeSetOverlap: [],
      childDurationSumMs: 2,
      childIntervalMs: 2,
      ok: true,
      failureReason: null,
    },
  } as HarnessRunResult;
}

function sampleSpec(acceptance: string[]): Spec {
  return {
    goal: "Add independent title mutation and deletion",
    requirements: ["PATCH title", "DELETE task"],
    constraints: ["Do not modify tests"],
    nonGoals: ["Bulk delete"],
    acceptance,
    verification: ["npm test"],
    ambiguities: [],
  };
}

function validPlan(overrides: Partial<FanOutPlan> = {}): FanOutPlan {
  return {
    baseRevision: SHA,
    maxParallelWorkers: FAN_OUT_MAX_PARALLEL_WORKERS,
    integrationOrder: ["A", "B"],
    units: [
      {
        id: "A",
        intent: "Title mutation",
        acceptanceRefs: ["PATCH /tasks/:id/title trims a non-empty title"],
        verificationIntent: ["title tests"],
        testFiles: ["tests/title-mutation.test.ts"],
        dependsOn: [],
      },
      {
        id: "B",
        intent: "Task deletion",
        acceptanceRefs: ["DELETE /tasks/:id returns the deleted task"],
        verificationIntent: ["delete tests"],
        testFiles: ["tests/task-deletion.test.ts"],
        dependsOn: [],
      },
    ],
    ...overrides,
  };
}

describe("FanOutPlan admission", () => {
  const spec = sampleSpec([
    "PATCH /tasks/:id/title trims a non-empty title",
    "DELETE /tasks/:id returns the deleted task",
  ]);

  it("admits a well-formed two-unit independent plan", () => {
    const admitted = admitFanOutPlan(validPlan(), spec);
    assert.equal(admitted.ok, true);
    if (admitted.ok) {
      assert.equal(admitted.value.maxParallelWorkers, 2);
      assert.deepEqual(admitted.value.integrationOrder, ["A", "B"]);
    }
  });

  it("rejects a non-exact baseRevision", () => {
    const parsed = parseFanOutPlanPayload({
      ...validPlan(),
      baseRevision: "HEAD",
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /exact 40-character commit SHA/);
    }
  });

  it("rejects a 3-unit FanOutPlan", () => {
    const extra = {
      ...validPlan().units[1],
      id: "C",
      acceptanceRefs: ["extra"],
    };
    const parsed = parseFanOutPlanPayload({
      ...validPlan(),
      units: [...validPlan().units, extra],
      integrationOrder: ["A", "B", "C"],
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /exactly 2 units/);
    }
    const admitted = admitFanOutPlan(
      {
        ...validPlan(),
        units: [...validPlan().units, extra],
        integrationOrder: ["A", "B", "C"],
      },
      sampleSpec([
        "PATCH /tasks/:id/title trims a non-empty title",
        "DELETE /tasks/:id returns the deleted task",
        "extra",
      ]),
    );
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.match(admitted.error, /exactly 2 units/);
    }
  });

  it("rejects maxParallelWorkers other than 2", () => {
    const parsed = parseFanOutPlanPayload({
      ...validPlan(),
      maxParallelWorkers: 4,
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /maxParallelWorkers must be 2/);
    }
  });

  it("rejects duplicate unit ids", () => {
    const parsed = parseFanOutPlanPayload({
      ...validPlan(),
      units: [validPlan().units[0], { ...validPlan().units[1], id: "A" }],
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /not unique/);
    }
  });

  it("rejects unknown acceptance refs and lost Spec coverage", () => {
    const unknown = admitFanOutPlan(
      validPlan({
        units: [
          {
            ...validPlan().units[0],
            acceptanceRefs: ["not in spec"],
          },
          validPlan().units[1],
        ],
      }),
      spec,
    );
    assert.equal(unknown.ok, false);
    if (!unknown.ok) {
      assert.match(unknown.error, /not in Spec.acceptance/);
    }

    const lost = admitFanOutPlan(
      validPlan({
        units: [
          { ...validPlan().units[0], acceptanceRefs: [] },
          validPlan().units[1],
        ],
      }),
      spec,
    );
    assert.equal(lost.ok, false);
    if (!lost.ok) {
      assert.match(lost.error, /missing Spec.acceptance coverage/);
    }
  });

  it("rejects dependencies between admitted fan-out units", () => {
    const parsed = parseFanOutPlanPayload({
      ...validPlan(),
      units: [
        validPlan().units[0],
        { ...validPlan().units[1], dependsOn: ["A"] },
      ],
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /must not declare dependencies/);
    }
  });

  it("rejects integrationOrder that is not an exact permutation", () => {
    const extra = parseFanOutPlanPayload({
      ...validPlan(),
      integrationOrder: ["A", "B", "C"],
    });
    assert.equal(extra.ok, false);

    const swappedDuplicate = parseFanOutPlanPayload({
      ...validPlan(),
      integrationOrder: ["A", "A"],
    });
    assert.equal(swappedDuplicate.ok, false);

    const unknown = parseFanOutPlanPayload({
      ...validPlan(),
      integrationOrder: ["A", "C"],
    });
    assert.equal(unknown.ok, false);
  });

  it("keeps FanOutUnit scope as process control, not product semantics", () => {
    const plan = validPlan();
    const scope = fanOutUnitExecutionScope(plan, plan.units[0]);
    assert.equal(scope.currentUnitId, "A");
    assert.deepEqual(scope.siblingUnits, [
      { id: "B", intent: "Task deletion" },
    ]);
    const text = formatWorkerFanOutUnitTask(
      "raw task",
      spec,
      plan,
      plan.units[0],
    );
    assert.match(text, new RegExp(FAN_OUT_PLAN_RULE));
    assert.match(text, new RegExp(FAN_OUT_UNIT_SCOPE_RULE));
    assert.match(text, /Implement only this unit/);
  });
});

describe("P03 frozen precedence", () => {
  it("freezes unknown-task 404 over title validation in the task text", () => {
    const task = fs.readFileSync(
      new URL("../../benchmarks/P03/task.md", import.meta.url),
      "utf8",
    );
    assert.match(task, /Unknown task takes precedence over title validation/);
    assert.match(
      task,
      /returns HTTP 404 regardless of whether the supplied title is valid/,
    );
  });
});

describe("manual P03 FanOutPlan binding", () => {
  it("shares every Spec.acceptance item with both units, including compile/all-tests wording", () => {
    const spec = sampleSpec([
      "The title-mutation tests pass.",
      "The deletion tests pass.",
      "All existing tests in tests/tasks.test.ts continue to pass.",
      "The implementation compiles under the repository's TypeScript/tsx test setup and all repository tests pass.",
    ]);
    const bound = bindP03FanOutPlan(spec, SHA);
    assert.equal(bound.ok, true);
    if (bound.ok) {
      assert.deepEqual(bound.value.units[0].acceptanceRefs, spec.acceptance);
      assert.deepEqual(bound.value.units[1].acceptanceRefs, spec.acceptance);
    }
  });

  it("binds the same frozen Spec identically for reuse across trials", () => {
    const spec = sampleSpec([
      "Title mutation works.",
      "Deletion works.",
      "Existing tests continue to pass.",
    ]);
    const first = bindP03FanOutPlan(spec, SHA);
    const second = bindP03FanOutPlan(spec, SHA);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.deepEqual(first.value.units[0].acceptanceRefs, spec.acceptance);
      assert.deepEqual(first.value.units, second.value.units);
    }
  });

  it("covers a representative resolved Spec without depending on ReviewPlan", () => {
    const spec = sampleSpec([
      'PATCHing an existing task with { title: "  New title  " } returns 200 and a task whose stored title is "New title".',
      "PATCH validation returns 400 for missing title, non-object body, non-string title, and blank/whitespace-only title.",
      "PATCHing an unknown id returns 404.",
      "DELETEing an existing task returns 200 and the deleted task; a subsequent GET for that id returns 404.",
      "DELETEing an unknown id returns 404.",
      "The existing tests in tests/tasks.test.ts continue to pass, and title/status/completedAt/list behavior remains unchanged.",
    ]);
    const bound = bindP03FanOutPlan(spec, SHA);
    assert.equal(bound.ok, true);
    if (bound.ok) {
      assert.deepEqual(bound.value.integrationOrder, ["A", "B"]);
      assert.equal(bound.value.units[0].dependsOn.length, 0);
      assert.equal(bound.value.units[1].dependsOn.length, 0);
      assert.ok(
        bound.value.units[0].acceptanceRefs.some((item) =>
          item.includes("PATCH"),
        ),
      );
      assert.ok(
        bound.value.units[1].acceptanceRefs.some((item) =>
          item.includes("DELETE"),
        ),
      );
    }
  });

  it("does not accept a ReviewPlan-shaped payload as a FanOutPlan", () => {
    const parsed = parseFanOutPlanPayload({
      decision: "decompose",
      rationale: "not a fan-out plan",
      units: [],
    });
    assert.equal(parsed.ok, false);
  });
});

describe("PAR01 decision rule", () => {
  it("is frozen before trials and does not treat a shorter child interval as support", () => {
    assert.match(PAR01_DECISION_RULE, /at least 20% lower than sequential/);
    assert.match(
      PAR01_DECISION_RULE,
      /Do not manufacture a positive conclusion merely because the child execution interval became shorter/,
    );

    const sequential = arm("sequential", [1000, 1100, 1200], [800, 850, 900]);
    const parallel = arm("parallel", [950, 1000, 1050], [400, 410, 420]);
    const decision = evaluatePar01Decision(sequential, parallel);
    assert.equal(decision.childIntervalShorter, true);
    assert.equal(decision.wallTimeImproved, false);
    assert.equal(decision.conclusion, "not_worth_current_workload");
    assert.equal(decision.defaultUnchanged, true);
  });

  it("supports PAR01 only when e2e wall time and cost criteria both hold", () => {
    const sequential = arm("sequential", [1000, 1100, 1200], [800, 850, 900]);
    const parallel = arm("parallel", [700, 720, 740], [400, 410, 420]);
    const decision = evaluatePar01Decision(sequential, parallel);
    assert.equal(decision.conclusion, "supported");
    assert.equal(decision.wallTimeImproved, true);
    assert.equal(decision.costRegressed, false);
  });
});

describe("PAR01 trial validity", () => {
  it("rejects Spec escalation and missing children as invalid scheduling trials", () => {
    const escalated = assessFanOutTrialValidity({
      fixtureApplied: true,
      error: null,
      result: {
        specDecision: { status: "needs_human_judgment", spec: sampleSpec([]) },
        fanOut: null,
      } as HarnessRunResult,
      expectedSchedule: "sequential",
    });
    assert.equal(escalated.valid, false);
    assert.equal(escalated.reason, "fan_out_not_started");

    const started = assessFanOutTrialValidity({
      fixtureApplied: true,
      error: null,
      expectedSchedule: "parallel",
      result: {
        specDecision: { status: "executable", spec: sampleSpec([]) },
        fanOut: {
          schedule: "parallel",
          children: [
            { unitId: "A", startedAt: 10 },
            { unitId: "B", startedAt: 11 },
          ],
        },
      } as HarnessRunResult,
    });
    assert.equal(started.valid, true);

    const wrongArm = assessFanOutTrialValidity({
      fixtureApplied: true,
      error: null,
      expectedSchedule: "sequential",
      result: {
        specDecision: { status: "executable", spec: sampleSpec([]) },
        fanOut: {
          schedule: "parallel",
          children: [
            { unitId: "A", startedAt: 10 },
            { unitId: "B", startedAt: 11 },
          ],
        },
      } as HarnessRunResult,
    });
    assert.equal(wrongArm.valid, false);
    assert.equal(wrongArm.reason, "schedule_mismatch");
  });

  it("rejects a trial whose workspace base differs from the frozen SHA", () => {
    const other = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const mismatch = assessFanOutTrialValidity({
      fixtureApplied: true,
      error: null,
      expectedSchedule: "parallel",
      expectedBaseRevision: SHA,
      baseRevision: other,
      result: startedResult(other, "parallel"),
    });
    assert.equal(mismatch.valid, false);
    assert.equal(mismatch.reason, "base_mismatch");

    const matched = assessFanOutTrialValidity({
      fixtureApplied: true,
      error: null,
      expectedSchedule: "parallel",
      expectedBaseRevision: SHA,
      baseRevision: SHA,
      result: startedResult(SHA, "parallel"),
    });
    assert.equal(matched.valid, true);
  });

  it("reuses one frozen base across experiment trials and records it", async () => {
    const other = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let calls = 0;
    const result = await runFanOutExperiment({
      frozenBaseRevision: SHA,
      frozenSpecFingerprint: "spec-fp",
      scoreExpected: () => false,
      runTrial: async (arm) => {
        calls += 1;
        const base = calls === 2 ? other : SHA;
        return {
          fixtureApplied: true,
          error: null,
          trialWallTimeMs: 10,
          preparedSourceFingerprint: "prep-fp",
          expectedSchedule: arm,
          baseRevision: base,
          result: startedResult(base, arm),
        };
      },
    });
    assert.equal(result.frozenBaseRevision, SHA);
    assert.equal(result.frozenSpecFingerprint, "spec-fp");
    assert.match(result.report, /frozenBaseRevision: a{40}/);
    assert.match(result.report, /preparedSourceFingerprint: prep-fp/);
    assert.equal(
      result.sequential.contaminated.some(
        (trial) => trial.validity.reason === "base_mismatch",
      ),
      true,
    );
    assert.equal(result.sequential.validTrials, 3);
    assert.equal(result.parallel.validTrials, 3);
    for (const trial of [...result.sequential.trials, ...result.parallel.trials]) {
      assert.equal(trial.baseRevision, SHA);
      assert.equal(trial.metrics?.baseRevision, SHA);
    }
  });

  it("reports final VERIFY as skipped when fan-in stops before the verifier", () => {
    const metrics = metricsFromP03Run(
      {
        workflowStatus: "failure",
        failureReason: "fan_in_conflict",
        specDecision: { status: "executable", spec: sampleSpec([]) },
        implementationStarted: true,
        finalVerificationPassed: false,
        finalVerification: null,
        finalReviewerOutcome: "skipped",
        repairAttempts: 0,
        reviewRepairAttempts: 0,
        modelCalls: 2,
        toolCalls: 4,
        changedFiles: [],
        durationMs: 100,
        contextMetrics: { tokenUsage: null },
        verifications: [],
        reviews: [],
        fanOut: {
          schedule: "parallel",
          children: [
            {
              unitId: "A",
              durationMs: 10,
              modelCalls: 1,
              toolCalls: 1,
              tokenUsage: null,
              changedFiles: [],
              verificationPassed: true,
              repairAttempts: 0,
            },
            {
              unitId: "B",
              durationMs: 10,
              modelCalls: 1,
              toolCalls: 1,
              tokenUsage: null,
              changedFiles: [],
              verificationPassed: true,
              repairAttempts: 0,
            },
          ],
          fanIn: {
            ok: false,
            durationMs: 5,
            conflict: {
              failedUnitId: "B",
              evidence: "merge conflict",
              appliedUnitIds: ["A"],
            },
            lostChanges: [],
          },
          writeSetOverlap: [],
          childDurationSumMs: 20,
          childIntervalMs: 10,
        },
      } as HarnessRunResult,
      false,
      100,
      "fp",
      SHA,
    );

    assert.equal(metrics.finalVerification, "skipped");
    assert.equal(metrics.finalVerifyDurationMs, null);
    assert.equal(metrics.finalReviewerOutcome, "skipped");
  });

  it("measures final VERIFY and REVIEW from real phase durations", () => {
    const metrics = metricsFromP03Run(
      {
        workflowStatus: "success",
        specDecision: { status: "executable", spec: sampleSpec([]) },
        implementationStarted: true,
        finalVerificationPassed: true,
        finalReviewerOutcome: "pass",
        repairAttempts: 0,
        reviewRepairAttempts: 0,
        modelCalls: 4,
        toolCalls: 8,
        changedFiles: [],
        durationMs: 1000,
        contextMetrics: { tokenUsage: null },
        verifications: [{ durationMs: 40 }],
        reviews: [{ durationMs: 60 }],
        finalVerification: { durationMs: 41 },
        fanOut: {
          schedule: "sequential",
          children: [
            {
              unitId: "A",
              durationMs: 10,
              modelCalls: 1,
              toolCalls: 1,
              tokenUsage: null,
              changedFiles: [],
              verificationPassed: true,
              repairAttempts: 0,
            },
            {
              unitId: "B",
              durationMs: 10,
              modelCalls: 1,
              toolCalls: 1,
              tokenUsage: null,
              changedFiles: [],
              verificationPassed: true,
              repairAttempts: 0,
            },
          ],
          fanIn: { ok: true, durationMs: 5, conflict: null, lostChanges: [] },
          writeSetOverlap: [],
          childDurationSumMs: 20,
          childIntervalMs: 20,
        },
      } as HarnessRunResult,
      true,
      1000,
      "fp",
      SHA,
    );
    assert.equal(metrics.finalVerifyDurationMs, 41);
    assert.equal(metrics.finalReviewDurationMs, 60);
    assert.equal(metrics.preparedSourceFingerprint, "fp");
    assert.equal("finalGateDurationMs" in metrics, false);
    assert.equal(metrics.baseRevision, SHA);
  });
});

function arm(
  id: "sequential" | "parallel",
  walls: number[],
  intervals: number[],
): FanOutArmReport {
  const trials: FanOutTrialRecord[] = walls.map((wall, index) => ({
    arm: id,
    attempt: index + 1,
    valid: true,
    validity: { valid: true, reason: "valid" },
    runId: `${id}-${index}`,
    tracePath: null,
    baseRevision: SHA,
    metrics: {
      expectedOutcomeMet: true,
      workflowStatus: "success",
      finalVerification: "PASS",
      finalReviewerOutcome: "pass",
      childVerificationPassed: true,
      fanInOk: true,
      integrationConflicts: false,
      lostChanges: [],
      writeSetOverlap: ["target-app/src/tasks/task-routes.ts"],
      childChangedFiles: { A: [], B: [] },
      finalChangedFiles: [],
      verificationRepairAttempts: 0,
      reviewRepairAttempts: 0,
      modelCalls: 20,
      toolCalls: 40,
      inputTokens: 10000,
      outputTokens: 2000,
      wallTimeMs: wall,
      childADurationMs: 400,
      childBDurationMs: 400,
      childDurationSumMs: 800,
      childIntervalMs: intervals[index],
      fanInDurationMs: 20,
      finalVerifyDurationMs: 80,
      finalReviewDurationMs: 120,
      preparedSourceFingerprint: "abc",
      baseRevision: SHA,
      children: [],
      schedule: id,
    },
  }));
  const mid = Math.floor(walls.length / 2);
  return {
    id,
    label: id,
    schedule: id,
    attemptedTrials: 3,
    validTrials: 3,
    expectedMet: 3,
    correctnessPreserved: 3,
    trials,
    contaminated: [],
    medians: {
      wallTimeMs: [...walls].sort((a, b) => a - b)[mid],
      modelCalls: 20,
      toolCalls: 40,
      inputTokens: 10000,
      outputTokens: 2000,
      childIntervalMs: [...intervals].sort((a, b) => a - b)[mid],
    },
  };
}
