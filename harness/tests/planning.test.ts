import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSpecContract, type Spec } from "../src/spec.ts";
import { formatReviewContext, type ReviewContext } from "../src/review.ts";
import {
  WORKER_PLAN_AUTHORITY_RULE,
  formatPlannerContext,
  formatWorkerHandoff,
  formatWorkerTask,
  parsePlanPayload,
  parseSubmitPlan,
  planDeviation,
  shouldRunPlanner,
  workerToolsForPlan,
  type Plan,
} from "../src/plan.ts";
import { PLANNER_TOOLS } from "../src/planner-phase.ts";
import { TOOL_DEFINITIONS, executeReadOnlyTool } from "../src/tools.ts";
import { resolveModel } from "../src/model-routing.ts";
import type { HarnessConfig } from "../src/config.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  evaluatePlanningDecision,
  type PlanningArmReport,
  type PlanningTrialRecord,
} from "../src/planning-experiment.ts";

function sampleSpec(): Spec {
  return {
    goal: "Add task priority",
    requirements: ['POST /tasks accepts optional priority "normal" | "high"'],
    constraints: ["Do not modify tests"],
    nonGoals: ["New status values"],
    acceptance: ["Missing priority defaults to normal"],
    verification: ["npm test"],
    ambiguities: [],
  };
}

function validPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    steps: [
      {
        intent: "Add priority to the Task type",
        likelyFiles: ["src/tasks/types.ts"],
        dependsOn: [],
      },
      {
        intent: "Thread priority through service create/list",
        likelyFiles: ["src/tasks/task-service.ts"],
        dependsOn: [0],
      },
    ],
    verificationIntent: ["Run npm test after mapping HTTP validation"],
    risks: ["Do not change completedAt semantics"],
    ...overrides,
  };
}

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-plan-"));
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

function reviewContext(): ReviewContext {
  return {
    spec: sampleSpec(),
    unifiedDiff: "--- tasks/types.ts\n+++ tasks/types.ts\n+ priority",
    changedFiles: ["tasks/types.ts"],
    architectureConstraints: [],
    verificationEvidence: {
      passed: true,
      exitCode: 0,
      durationMs: 8,
      attempt: 1,
    },
  };
}

describe("plan admission", () => {
  it("accepts a valid structured plan", () => {
    const parsed = parseSubmitPlan(JSON.stringify(validPlan()));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.steps.length, 2);
      assert.deepEqual(parsed.value.steps[1].dependsOn, [0]);
    }
  });

  it("rejects empty steps", () => {
    const parsed = parsePlanPayload({
      steps: [],
      verificationIntent: ["npm test"],
      risks: ["none"],
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /steps must be a non-empty array/);
    }
  });

  it("rejects an invalid dependency index", () => {
    const parsed = parsePlanPayload(
      validPlan({
        steps: [
          {
            intent: "Only step",
            likelyFiles: ["src/tasks/types.ts"],
            dependsOn: [3],
          },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /invalid step index/);
    }
  });

  it("rejects a self dependency", () => {
    const parsed = parsePlanPayload(
      validPlan({
        steps: [
          {
            intent: "Cycle",
            likelyFiles: ["src/tasks/types.ts"],
            dependsOn: [0],
          },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /must not reference itself/);
    }
  });

  it("rejects a two-step dependency cycle", () => {
    const parsed = parsePlanPayload(
      validPlan({
        steps: [
          {
            intent: "First",
            likelyFiles: ["src/tasks/types.ts"],
            dependsOn: [1],
          },
          {
            intent: "Second",
            likelyFiles: ["src/tasks/task-service.ts"],
            dependsOn: [0],
          },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /dependency cycle/);
    }
  });

  it("rejects a longer dependency cycle", () => {
    const parsed = parsePlanPayload(
      validPlan({
        steps: [
          {
            intent: "A",
            likelyFiles: ["src/tasks/types.ts"],
            dependsOn: [1],
          },
          {
            intent: "B",
            likelyFiles: ["src/tasks/task-service.ts"],
            dependsOn: [2],
          },
          {
            intent: "C",
            likelyFiles: ["src/tasks/task-routes.ts"],
            dependsOn: [0],
          },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /dependency cycle/);
    }
  });

  it("accepts valid acyclic dependencies", () => {
    const parsed = parsePlanPayload(
      validPlan({
        steps: [
          {
            intent: "Types",
            likelyFiles: ["src/tasks/types.ts"],
            dependsOn: [],
          },
          {
            intent: "Service",
            likelyFiles: ["src/tasks/task-service.ts"],
            dependsOn: [0],
          },
          {
            intent: "Routes",
            likelyFiles: ["src/tasks/task-routes.ts"],
            dependsOn: [0, 1],
          },
        ],
      }),
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(
        parsed.value.steps.map((step) => step.dependsOn),
        [[], [0], [0, 1]],
      );
    }
  });

  it("rejects absolute and traversal likelyFiles", () => {
    const absolute = parsePlanPayload(
      validPlan({
        steps: [
          {
            intent: "Bad path",
            likelyFiles: ["/etc/passwd"],
            dependsOn: [],
          },
        ],
      }),
    );
    assert.equal(absolute.ok, false);

    const traversal = parsePlanPayload(
      validPlan({
        steps: [
          {
            intent: "Bad path",
            likelyFiles: ["src/../secrets.ts"],
            dependsOn: [],
          },
        ],
      }),
    );
    assert.equal(traversal.ok, false);
  });
});

describe("planner tool boundary", () => {
  it("advertises only read-only repository tools plus submit_plan", () => {
    assert.deepEqual(
      PLANNER_TOOLS.map((tool) => tool.name),
      ["list_files", "read_file", "submit_plan"],
    );
  });

  it("rejects write_file and run_command in the planner phase", () => {
    const config = tempConfig();
    const write = executeReadOnlyTool(
      config,
      "write_file",
      JSON.stringify({ path: "app.ts", content: "hacked" }),
    );
    assert.equal(write.ok, false);
    assert.match(write.output, /read-only/i);
    const written = fs.readFileSync(
      path.join(config.targetSrcRoot, "app.ts"),
      "utf8",
    );
    assert.equal(written, "export const ok = true;\n");

    const command = executeReadOnlyTool(
      config,
      "run_command",
      JSON.stringify({ command: "npm test" }),
    );
    assert.equal(command.ok, false);
    assert.match(command.output, /read-only/i);
  });

  it("routes the plan episode with the default model, not a planner-specific override", () => {
    const selected = resolveModel("plan", {
      model: "gpt-5.6-luna",
      repairModel: "gpt-5.6-terra",
    });
    assert.equal(selected.model, "gpt-5.6-luna");
    assert.equal(selected.reason, "default");
  });
});

describe("plan is advisory, not edit-scope authority", () => {
  it("does not turn likelyFiles into a write allowlist", () => {
    const plan = validPlan();
    const tools = workerToolsForPlan(plan);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      TOOL_DEFINITIONS.map((tool) => tool.name),
    );
    assert.ok(tools.some((tool) => tool.name === "write_file"));
    const handoff = formatWorkerHandoff("task", sampleSpec(), plan);
    assert.match(handoff, /not an authorized edit scope/);
    assert.doesNotMatch(handoff, /only edit likelyFiles/i);
  });
});

describe("worker handoff", () => {
  it("keeps resolved Spec separate from the advisory Plan and states the authority rule", () => {
    const spec = sampleSpec();
    const plan = validPlan();
    const handoff = formatWorkerHandoff("Add priority", spec, plan);
    assert.match(handoff, /## Authoritative specification/);
    assert.match(handoff, /## Advisory implementation plan \(not authority\)/);
    assert.ok(handoff.includes(WORKER_PLAN_AUTHORITY_RULE));
    assert.ok(
      handoff.indexOf("## Authoritative specification") <
        handoff.indexOf("## Advisory implementation plan"),
    );
    assert.match(handoff, /Add task priority/);
    assert.match(handoff, /Thread priority through service create\/list/);
  });

  it("gives the planner the resolved Spec without write authority language", () => {
    const context = formatPlannerContext({
      originalTask: "Add priority",
      spec: sampleSpec(),
    });
    assert.match(context, /## Authoritative resolved spec/);
    assert.doesNotMatch(context, /write_file/);
  });
});

describe("reviewer independence from the plan", () => {
  it("does not include Plan, planner rationale, or worker reasoning in review context", () => {
    const formatted = formatReviewContext(reviewContext());
    assert.doesNotMatch(formatted, /Advisory implementation plan/);
    assert.doesNotMatch(formatted, /likelyFiles/);
    assert.doesNotMatch(formatted, /WORKER_PLAN_AUTHORITY_RULE/);
    assert.doesNotMatch(formatted, /implementation hypothesis/);
    assert.equal("plan" in reviewContext(), false);
    assert.match(formatted, /## Authoritative resolved spec/);
    assert.match(formatted, /## Current unified diff/);
  });
});

describe("baseline path when planning is disabled", () => {
  it("does not run the planner unless explicitly enabled", () => {
    assert.equal(shouldRunPlanner(false), false);
    assert.equal(shouldRunPlanner(true), true);
  });

  it("keeps the existing Worker spec contract when no Plan is present", () => {
    const spec = sampleSpec();
    const task = "Add priority";
    assert.equal(
      formatWorkerTask(task, spec, null),
      formatSpecContract(task, spec),
    );
    assert.doesNotMatch(
      formatWorkerTask(task, spec, null),
      /Advisory implementation plan/,
    );
  });
});

describe("plan deviation evidence", () => {
  it("records extra and unused files without treating deviation as failure", () => {
    const deviation = planDeviation(validPlan(), ["tasks/task-routes.ts"]);
    assert.deepEqual(deviation.actualChangedFiles, ["tasks/task-routes.ts"]);
    assert.ok(deviation.extraChangedFiles.includes("tasks/task-routes.ts"));
    assert.ok(deviation.unusedLikelyFiles.length > 0);
  });
});

describe("predefined planner decision rule", () => {
  function arm(
    id: "baseline" | "variant",
    expectedMet: number,
    averages: Partial<PlanningArmReport["averages"]>,
  ): PlanningArmReport {
    const trials: PlanningTrialRecord[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      trials.push({
        arm: id,
        attempt,
        valid: true,
        validity: { valid: true, reason: "valid" },
        runId: `${id}-${attempt}`,
        tracePath: `/tmp/${id}-${attempt}.jsonl`,
        metrics: {
          expectedOutcomeMet: attempt <= expectedMet,
          workflowStatus: attempt <= expectedMet ? "success" : "failure",
          finalVerification: attempt <= expectedMet ? "PASS" : "FAIL",
          firstVerification: attempt <= expectedMet ? "PASS" : "FAIL",
          verificationRepairAttempts: 0,
          reviewRepairAttempts: 0,
          acceptedBlockingFindings: 0,
          changedFiles: ["tasks/types.ts"],
          modelCalls: 10,
          toolCalls: 20,
          inputTokens: 20000,
          outputTokens: 2000,
          wallTimeMs: 30000,
          plannerModelCalls: id === "variant" ? 2 : 0,
          plannerToolCalls: id === "variant" ? 4 : 0,
          plannerInputTokens: id === "variant" ? 4000 : 0,
          plannerOutputTokens: id === "variant" ? 400 : 0,
          plannerWallTimeMs: id === "variant" ? 8000 : 0,
          workerModelCalls: 4,
          workerToolCalls: 8,
          plannedLikelyFiles: [],
          actualChangedFiles: ["tasks/types.ts"],
          extraChangedFiles: [],
          unusedLikelyFiles: [],
          planningEnabled: id === "variant",
          planAccepted: id === "variant",
        },
      });
    }
    return {
      id,
      label: id,
      planningEnabled: id === "variant",
      attemptedTrials: 3,
      validTrials: 3,
      expectedMet,
      firstVerificationPass: expectedMet,
      trials,
      contaminated: [],
      averages: {
        modelCalls: averages.modelCalls ?? 10,
        toolCalls: averages.toolCalls ?? 20,
        inputTokens: averages.inputTokens ?? 20000,
        outputTokens: averages.outputTokens ?? 2000,
        wallTimeMs: averages.wallTimeMs ?? 30000,
        plannerModelCalls: id === "variant" ? 2 : 0,
        plannerToolCalls: id === "variant" ? 4 : 0,
        workerModelCalls: 4,
        workerToolCalls: 8,
        verificationRepairAttempts: 0,
        reviewRepairAttempts: 0,
      },
    };
  }

  it("rejects the planner when quality is equal and variant costs more end-to-end", () => {
    const decision = evaluatePlanningDecision(
      arm("baseline", 3, {}),
      arm("variant", 3, {
        modelCalls: 12,
        toolCalls: 24,
        inputTokens: 25000,
        outputTokens: 2500,
        wallTimeMs: 40000,
      }),
    );
    assert.equal(decision.quality, "equal");
    assert.equal(decision.efficiency, "variant_worse");
    assert.equal(decision.conclusion, "reject");
    assert.equal(decision.defaultUnchanged, true);
  });

  it("does not invent a numeric threshold when signals conflict", () => {
    const decision = evaluatePlanningDecision(
      arm("baseline", 3, {
        modelCalls: 10,
        toolCalls: 20,
        inputTokens: 20000,
        outputTokens: 2000,
        wallTimeMs: 40000,
      }),
      arm("variant", 3, {
        modelCalls: 12,
        toolCalls: 18,
        inputTokens: 18000,
        outputTokens: 2200,
        wallTimeMs: 30000,
      }),
    );
    assert.equal(decision.quality, "equal");
    assert.equal(decision.efficiency, "noisy");
    assert.equal(decision.conclusion, "inconclusive");
  });

  it("does not emit candidate for directional e2e improvement without a predefined meaningful threshold", () => {
    const decision = evaluatePlanningDecision(
      arm("baseline", 3, {}),
      arm("variant", 3, {
        modelCalls: 8,
        toolCalls: 16,
        inputTokens: 18000,
        outputTokens: 1800,
        wallTimeMs: 25000,
      }),
    );
    assert.equal(decision.quality, "equal");
    assert.equal(decision.efficiency, "variant_better");
    assert.equal(decision.conclusion, "inconclusive");
    assert.notEqual(decision.conclusion, "candidate");
  });
});
