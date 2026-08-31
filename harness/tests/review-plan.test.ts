import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REVIEW_PLAN_AUTHORITY_RULE,
  UNIT_EXECUTION_SCOPE_RULE,
  admitReviewPlan,
  cumulativeTestFiles,
  formatWorkerUnitTask,
  orderedUnits,
  parseReviewPlanPayload,
  shouldContinueDecomposedUnits,
  unitExecutionScope,
  type ReviewPlan,
} from "../src/review-plan.ts";
import {
  bindP02ReviewPlan,
  evaluateDecompositionDecision,
  P02_REVIEW_UNIT_TEMPLATES,
  type DecompositionArmReport,
  type DecompositionTrialRecord,
} from "../src/decomposition-experiment.ts";
import type { Spec } from "../src/spec.ts";

function sampleSpec(acceptance: string[]): Spec {
  return {
    goal: "Add due dates",
    requirements: ["Task has optional dueAt"],
    constraints: ["Do not modify tests"],
    nonGoals: ["Recurring tasks"],
    acceptance,
    verification: ["npm test"],
    ambiguities: [],
  };
}

function validPlan(overrides: Partial<ReviewPlan> = {}): ReviewPlan {
  return {
    decision: "decompose",
    rationale: "Semantic units for human review",
    units: [
      {
        id: "A",
        intent: "Establish dueAt",
        acceptanceRefs: ["Task has optional dueAt"],
        dependsOn: [],
        verificationIntent: ["unit A tests"],
      },
      {
        id: "B",
        intent: "Allow PATCH",
        acceptanceRefs: ["PATCH updates dueAt"],
        dependsOn: ["A"],
        verificationIntent: ["unit B tests"],
      },
      {
        id: "C",
        intent: "Add overdue query",
        acceptanceRefs: ["GET due=overdue returns overdue pending tasks"],
        dependsOn: ["A"],
        verificationIntent: ["unit C tests"],
      },
    ],
    ...overrides,
  };
}

const P02_ACCEPTANCE = [
  "Task has optional dueAt and POST /tasks defaults missing dueAt to null",
  "Invalid dueAt on create returns 400",
  "complete and reopen preserve dueAt",
  "PATCH /tasks/:id/due-date can set or clear dueAt",
  "Unknown task PATCH returns 404",
  "GET /tasks?due=overdue returns overdue pending tasks and excludes completed",
  "due filtering composes with the existing status filter",
];

const VARIANT1_ACCEPTANCE = [
  "A task created without dueAt is returned with dueAt null.",
  "A task created with null or a valid date string is accepted and the exact string is returned.",
  "Create requests with non-string non-null, empty, or unparseable dueAt values return 400 and do not create a valid task.",
  "PATCH /tasks/:id/due-date can set a valid exact string and can clear it with null; missing/invalid payloads return 400 and unknown IDs return 404.",
  "GET /tasks?due=overdue returns only pending tasks with parsed due times strictly earlier than now, excludes completed/no-date/future tasks, rejects invalid due values, and composes with status filtering.",
  "complete and reopen responses retain dueAt, and reopening an overdue task makes it appear in overdue results.",
  "Existing tests for task retrieval, status filtering, completion, reopening, and completedAt continue to pass.",
];

describe("ReviewPlan admission", () => {
  it("accepts a valid decompose plan that covers Spec.acceptance", () => {
    const spec = sampleSpec([
      "Task has optional dueAt",
      "PATCH updates dueAt",
      "GET due=overdue returns overdue pending tasks",
    ]);
    const admitted = admitReviewPlan(validPlan(), spec);
    assert.equal(admitted.ok, true);
    if (admitted.ok) {
      assert.deepEqual(
        orderedUnits(admitted.value).map((unit) => unit.id),
        ["A", "B", "C"],
      );
    }
  });

  it("rejects duplicate unit ids", () => {
    const parsed = parseReviewPlanPayload(
      validPlan({
        units: [
          {
            id: "A",
            intent: "one",
            acceptanceRefs: ["Task has optional dueAt"],
            dependsOn: [],
            verificationIntent: [],
          },
          {
            id: "A",
            intent: "two",
            acceptanceRefs: ["Task has optional dueAt"],
            dependsOn: [],
            verificationIntent: [],
          },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /unique/);
    }
  });

  it("rejects unknown and cyclic dependencies", () => {
    const unknown = parseReviewPlanPayload(
      validPlan({
        units: [
          {
            id: "A",
            intent: "A",
            acceptanceRefs: ["Task has optional dueAt"],
            dependsOn: ["Z"],
            verificationIntent: [],
          },
        ],
      }),
    );
    assert.equal(unknown.ok, false);

    const cyclic = parseReviewPlanPayload(
      validPlan({
        units: [
          {
            id: "A",
            intent: "A",
            acceptanceRefs: ["Task has optional dueAt"],
            dependsOn: ["B"],
            verificationIntent: [],
          },
          {
            id: "B",
            intent: "B",
            acceptanceRefs: ["PATCH updates dueAt"],
            dependsOn: ["A"],
            verificationIntent: [],
          },
        ],
      }),
    );
    assert.equal(cyclic.ok, false);
    if (!cyclic.ok) {
      assert.match(cyclic.error, /cycle/);
    }
  });

  it("rejects acceptance refs that are not in the Spec", () => {
    const spec = sampleSpec(["Task has optional dueAt"]);
    const admitted = admitReviewPlan(validPlan(), spec);
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.match(admitted.error, /not in Spec.acceptance/);
    }
  });

  it("accepts shared Spec.acceptance ownership across units", () => {
    const shared = "complete and reopen preserve dueAt";
    const spec = sampleSpec([
      "Task has optional dueAt",
      shared,
      "GET due=overdue returns overdue pending tasks",
    ]);
    const admitted = admitReviewPlan(
      {
        decision: "decompose",
        rationale: "Shared ownership is valid",
        units: [
          {
            id: "A",
            intent: "capability",
            acceptanceRefs: ["Task has optional dueAt", shared],
            dependsOn: [],
            verificationIntent: [],
          },
          {
            id: "C",
            intent: "overdue",
            acceptanceRefs: [shared, "GET due=overdue returns overdue pending tasks"],
            dependsOn: ["A"],
            verificationIntent: [],
          },
        ],
      },
      spec,
    );
    assert.equal(admitted.ok, true);
  });

  it("rejects decompose plans that miss Spec.acceptance coverage", () => {
    const spec = sampleSpec([
      "Task has optional dueAt",
      "PATCH updates dueAt",
      "GET due=overdue returns overdue pending tasks",
      "Unowned criterion",
    ]);
    const admitted = admitReviewPlan(validPlan(), spec);
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.match(admitted.error, /missing Spec.acceptance coverage/);
    }
  });

  it("allows single_change with empty units", () => {
    const spec = sampleSpec(["anything"]);
    const admitted = admitReviewPlan(
      {
        decision: "single_change",
        rationale: "P01-sized cohesive change",
        units: [],
      },
      spec,
    );
    assert.equal(admitted.ok, true);
  });

  it("does not mutate the Spec", () => {
    const spec = sampleSpec([
      "Task has optional dueAt",
      "PATCH updates dueAt",
      "GET due=overdue returns overdue pending tasks",
    ]);
    const before = JSON.stringify(spec);
    admitReviewPlan(validPlan(), spec);
    assert.equal(JSON.stringify(spec), before);
  });
});

describe("manual P02 ReviewPlan binding", () => {
  it("assigns every Spec.acceptance item to a semantic unit", () => {
    const spec = sampleSpec(P02_ACCEPTANCE);
    const bound = bindP02ReviewPlan(spec);
    assert.equal(bound.ok, true);
    if (!bound.ok) {
      return;
    }
    assert.equal(bound.value.decision, "decompose");
    const owned = new Set(
      bound.value.units.flatMap((unit) => unit.acceptanceRefs),
    );
    for (const item of spec.acceptance) {
      assert.equal(owned.has(item), true, item);
    }
    assert.deepEqual(
      orderedUnits(bound.value).map((unit) => unit.id),
      ["A", "B", "C"],
    );
  });

  it("covers a real P02 Spec.acceptance list with precise and shared ownership", () => {
    const spec = sampleSpec(VARIANT1_ACCEPTANCE);
    const bound = bindP02ReviewPlan(spec);
    assert.equal(bound.ok, true);
    if (!bound.ok) {
      return;
    }
    const byId = new Map(bound.value.units.map((unit) => [unit.id, unit]));
    const patch = VARIANT1_ACCEPTANCE[3];
    const overdueOnly = VARIANT1_ACCEPTANCE[4];
    const shared = VARIANT1_ACCEPTANCE[5];

    assert.equal(byId.get("A")?.acceptanceRefs.includes(shared), true);
    assert.equal(byId.get("C")?.acceptanceRefs.includes(shared), true);
    assert.equal(byId.get("B")?.acceptanceRefs.includes(shared), false);

    assert.equal(byId.get("B")?.acceptanceRefs.includes(patch), true);
    assert.equal(byId.get("A")?.acceptanceRefs.includes(patch), false);

    assert.equal(byId.get("C")?.acceptanceRefs.includes(overdueOnly), true);
    assert.equal(byId.get("A")?.acceptanceRefs.includes(overdueOnly), false);
  });

  it("does not treat completed-overdue wording as lifecycle preservation", () => {
    const overdueOnly =
      "Completed tasks are excluded from GET /tasks?due=overdue results.";
    const spec = sampleSpec([
      "A task created without dueAt is returned with dueAt null.",
      "PATCH /tasks/:id/due-date updates dueAt.",
      overdueOnly,
    ]);
    const bound = bindP02ReviewPlan(spec);
    assert.equal(bound.ok, true);
    if (!bound.ok) {
      return;
    }
    const byId = new Map(bound.value.units.map((unit) => [unit.id, unit]));
    assert.equal(byId.get("A")?.acceptanceRefs.includes(overdueOnly), false);
    assert.equal(byId.get("C")?.acceptanceRefs.includes(overdueOnly), true);
  });

  it("keeps ReviewPlan advisory and UnitExecutionScope harness-owned", () => {
    const spec = sampleSpec(P02_ACCEPTANCE);
    const bound = bindP02ReviewPlan(spec);
    assert.equal(bound.ok, true);
    if (!bound.ok) {
      return;
    }
    const current = bound.value.units[0];
    const text = formatWorkerUnitTask(
      "raw task",
      spec,
      bound.value,
      current,
    );
    assert.match(text, /Authoritative specification/);
    assert.match(text, /Later units remain required by this Spec/);
    assert.match(text, /Advisory ReviewPlan \(not execution authority\)/);
    assert.match(text, new RegExp(REVIEW_PLAN_AUTHORITY_RULE));
    assert.match(text, /UnitExecutionScope \(harness-owned, this episode only\)/);
    assert.match(text, new RegExp(UNIT_EXECUTION_SCOPE_RULE));
    assert.doesNotMatch(text, /this unit is the Spec/i);
    const scope = unitExecutionScope(bound.value, current);
    assert.equal(scope.currentUnitId, "A");
    assert.deepEqual(
      scope.deferredUnits.map((unit) => unit.id),
      ["B", "C"],
    );
    assert.match(text, /"currentUnitId": "A"/);
    assert.match(text, /"id": "B"/);
    assert.match(text, /"id": "C"/);
  });

  it("shares overlapping acceptance across units instead of winner-takes-all", () => {
    const shared =
      "complete and reopen responses retain dueAt, and reopening an overdue task makes it appear in overdue results.";
    const spec = sampleSpec([
      "A task created without dueAt is returned with dueAt null.",
      "PATCH /tasks/:id/due-date can set a valid exact string and can clear it with null; missing/invalid payloads return 400 and unknown IDs return 404.",
      "GET /tasks?due=overdue returns only pending tasks with parsed due times strictly earlier than now.",
      shared,
    ]);
    const bound = bindP02ReviewPlan(spec);
    assert.equal(bound.ok, true);
    if (!bound.ok) {
      return;
    }
    const byId = new Map(bound.value.units.map((unit) => [unit.id, unit]));
    assert.equal(byId.get("A")?.acceptanceRefs.includes(shared), true);
    assert.equal(byId.get("C")?.acceptanceRefs.includes(shared), true);
    assert.equal(byId.get("B")?.acceptanceRefs.includes(shared), false);
  });

  it("rejects unmapped Spec.acceptance instead of dumping it onto unit A", () => {
    const spec = sampleSpec([
      ...P02_ACCEPTANCE,
      "Unmapped xyzzy calendar reminder notifications",
    ]);
    const bound = bindP02ReviewPlan(spec);
    assert.equal(bound.ok, false);
    if (!bound.ok) {
      assert.match(bound.error, /unmapped Spec.acceptance/);
    }
  });

  it("accumulates scoped tests without requiring later unit files", () => {
    assert.deepEqual(cumulativeTestFiles(["A"], P02_REVIEW_UNIT_TEMPLATES), [
      "tests/tasks.test.ts",
      "tests/due-date-capability.test.ts",
    ]);
    assert.deepEqual(
      cumulativeTestFiles(["A", "B"], P02_REVIEW_UNIT_TEMPLATES),
      [
        "tests/tasks.test.ts",
        "tests/due-date-capability.test.ts",
        "tests/due-date-mutation.test.ts",
      ],
    );
  });
});

describe("unit execution gate", () => {
  it("stops later units after a failed intermediate verify", () => {
    assert.equal(shouldContinueDecomposedUnits(true), true);
    assert.equal(shouldContinueDecomposedUnits(false), false);
  });
});

describe("decomposition decision rule", () => {
  it("rejects worse quality even if units look cheaper", () => {
    const baseline = arm("baseline", { expectedMet: 3, modelCalls: 12 });
    const variant = arm("variant", { expectedMet: 1, modelCalls: 8 });
    const decision = evaluateDecompositionDecision(baseline, variant);
    assert.equal(decision.quality, "variant_worse");
    assert.equal(decision.conclusion, "reject");
    assert.equal(decision.defaultUnchanged, true);
  });

  it("rejects invalid intermediate verification", () => {
    const baseline = arm("baseline", { expectedMet: 3, modelCalls: 10 });
    const variant = arm("variant", {
      expectedMet: 3,
      modelCalls: 20,
      intermediateValid: false,
    });
    const decision = evaluateDecompositionDecision(baseline, variant);
    assert.equal(decision.intermediateValid, false);
    assert.equal(decision.conclusion, "reject");
  });

  it("marks empty later units as mechanism_failed", () => {
    const baseline = arm("baseline", { expectedMet: 3, modelCalls: 10 });
    const variant = arm("variant", {
      expectedMet: 3,
      modelCalls: 20,
      emptyUnitDiffs: 2,
    });
    const decision = evaluateDecompositionDecision(baseline, variant);
    assert.equal(decision.quality, "equal");
    assert.equal(decision.genuineReviewSurfaces, false);
    assert.equal(decision.conclusion, "mechanism_failed");
    assert.equal(decision.defaultUnchanged, true);
  });

  it("keeps equal quality and extra cost as candidate_pending_human_review", () => {
    const baseline = arm("baseline", { expectedMet: 3, modelCalls: 10 });
    const variant = arm("variant", { expectedMet: 3, modelCalls: 22 });
    const decision = evaluateDecompositionDecision(baseline, variant);
    assert.equal(decision.quality, "equal");
    assert.equal(decision.efficiency, "variant_worse");
    assert.equal(decision.genuineReviewSurfaces, true);
    assert.equal(decision.conclusion, "candidate_pending_human_review");
    assert.equal(decision.defaultUnchanged, true);
  });
});

function arm(
  id: "baseline" | "variant",
  options: {
    expectedMet: number;
    modelCalls: number;
    emptyUnitDiffs?: number;
    unitCount?: number;
    intermediateValid?: boolean;
  },
): DecompositionArmReport {
  const emptyUnitDiffs = options.emptyUnitDiffs ?? 0;
  const unitCount = options.unitCount ?? (id === "variant" ? 3 : 0);
  const intermediateValid = options.intermediateValid ?? true;
  const trials: DecompositionTrialRecord[] = [1, 2, 3].map((attempt) => ({
    arm: id,
    attempt,
    valid: true,
    validity: { valid: true, reason: "valid" },
    runId: `${id}-${attempt}`,
    tracePath: null,
    metrics: {
      expectedOutcomeMet: attempt <= options.expectedMet,
      workflowStatus: "success",
      finalVerification: "PASS",
      firstVerification: "PASS",
      verificationRepairAttempts: 0,
      reviewRepairAttempts: 0,
      acceptedBlockingFindings: 0,
      changedFiles: ["tasks/types.ts"],
      finalDiffLines: 80,
      modelCalls: options.modelCalls,
      toolCalls: 20,
      inputTokens: 30000,
      outputTokens: 4000,
      wallTimeMs: 50000,
      reviewPlanDecision: id === "variant" ? "decompose" : null,
      unitCount,
      units: [],
      intermediateValid,
      emptyUnitDiffs,
      reviewabilityReportPath: null,
    },
  }));
  return {
    id,
    label: id,
    decomposed: id === "variant",
    attemptedTrials: 3,
    validTrials: 3,
    expectedMet: options.expectedMet,
    firstVerificationPass: 3,
    intermediateValid: intermediateValid ? 3 : 0,
    trials,
    contaminated: [],
    averages: {
      modelCalls: options.modelCalls,
      toolCalls: 20,
      inputTokens: 30000,
      outputTokens: 4000,
      wallTimeMs: 50000,
      finalDiffLines: 80,
      verificationRepairAttempts: 0,
      reviewRepairAttempts: 0,
    },
  };
}