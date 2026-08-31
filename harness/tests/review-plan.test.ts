import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REVIEW_PLAN_AUTHORITY_RULE,
  admitReviewPlan,
  cumulativeTestFiles,
  formatWorkerUnitTask,
  orderedUnits,
  parseReviewPlanPayload,
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

  it("keeps the Worker unit handoff advisory", () => {
    const spec = sampleSpec(P02_ACCEPTANCE);
    const bound = bindP02ReviewPlan(spec);
    assert.equal(bound.ok, true);
    if (!bound.ok) {
      return;
    }
    const text = formatWorkerUnitTask("raw task", spec, bound.value.units[0]);
    assert.match(text, /Authoritative specification/);
    assert.match(text, /advisory, not authority/i);
    assert.match(text, new RegExp(REVIEW_PLAN_AUTHORITY_RULE));
    assert.doesNotMatch(text, /this unit is the Spec/i);
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

describe("decomposition decision rule", () => {
  it("rejects worse quality even if units look cheaper", () => {
    const baseline = arm("baseline", { expectedMet: 3, modelCalls: 12 });
    const variant = arm("variant", { expectedMet: 1, modelCalls: 8 });
    const decision = evaluateDecompositionDecision(baseline, variant);
    assert.equal(decision.quality, "variant_worse");
    assert.equal(decision.conclusion, "reject");
    assert.equal(decision.defaultUnchanged, true);
  });

  it("does not auto-adopt equal quality with extra overhead", () => {
    const baseline = arm("baseline", { expectedMet: 3, modelCalls: 10 });
    const variant = arm("variant", { expectedMet: 3, modelCalls: 22 });
    const decision = evaluateDecompositionDecision(baseline, variant);
    assert.equal(decision.quality, "equal");
    assert.equal(decision.efficiency, "variant_worse");
    assert.equal(decision.conclusion, "reject");
    assert.equal(decision.defaultUnchanged, true);
  });
});

function arm(
  id: "baseline" | "variant",
  options: { expectedMet: number; modelCalls: number },
): DecompositionArmReport {
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
      unitCount: id === "variant" ? 3 : 0,
      units: [],
      intermediateValid: true,
      emptyUnitDiffs: 0,
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
    intermediateValid: 3,
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
