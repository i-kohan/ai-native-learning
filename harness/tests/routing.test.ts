import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { HarnessConfig } from "../src/config.ts";
import { normalizeFailure } from "../src/failure.ts";
import {
  resolveModel,
  routingTraceFields,
  type ModelEpisode,
} from "../src/model-routing.ts";
import {
  isIntendedR01ControlledFailure,
  R01_CONTROLLED_ASSERTION,
  R01_CONTROLLED_FAILED_TEST,
} from "../src/r01-fault.ts";
import {
  assessRoutingTrialValidity,
  type RoutingTrialEvidence,
} from "../src/routing-experiment.ts";
import {
  READ_ONLY_TOOL_DEFINITIONS,
  TOOL_DEFINITIONS,
  executeTool,
} from "../src/tools.ts";

const EPISODES: ModelEpisode[] = [
  "spec",
  "plan",
  "implementation",
  "research",
  "repair",
  "review",
  "review_repair",
];

const DEFAULT_MODEL = "gpt-5.6-luna";
const REPAIR_OVERRIDE = "gpt-5.6-terra";

const R01_FAIL_OUTPUT = `✖ ${R01_CONTROLLED_FAILED_TEST} (0.382208ms)
  AssertionError [ERR_ASSERTION]: ${R01_CONTROLLED_ASSERTION}`;

function routingConfig(
  repairModel?: string,
): Pick<HarnessConfig, "model" | "repairModel"> {
  return repairModel
    ? { model: DEFAULT_MODEL, repairModel }
    : { model: DEFAULT_MODEL };
}

function tempToolConfig(model: string): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "routing-tools-"));
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
    model,
    maxTurns: 20,
    maxRepairAttempts: 2,
    maxReviewRepairAttempts: 1,
    repoRoot: root,
    targetAppRoot,
    targetSrcRoot,
    tracesDir: path.join(root, "traces"),
  };
}

describe("model routing", () => {
  it("uses the default model for every episode when repair override is absent", () => {
    const config = routingConfig();
    for (const episode of EPISODES) {
      const selected = resolveModel(episode, config);
      assert.equal(selected.episode, episode);
      assert.equal(selected.model, DEFAULT_MODEL);
      assert.equal(selected.reason, "default");
    }
  });

  it("applies repair override only to the verification-repair episode", () => {
    const config = routingConfig(REPAIR_OVERRIDE);
    const expected: Record<ModelEpisode, { model: string; reason: string }> = {
      spec: { model: DEFAULT_MODEL, reason: "default" },
      plan: { model: DEFAULT_MODEL, reason: "default" },
      implementation: { model: DEFAULT_MODEL, reason: "default" },
      research: { model: DEFAULT_MODEL, reason: "default" },
      repair: { model: REPAIR_OVERRIDE, reason: "repair_override" },
      review: { model: DEFAULT_MODEL, reason: "default" },
      review_repair: { model: DEFAULT_MODEL, reason: "default" },
    };

    for (const episode of EPISODES) {
      const selected = resolveModel(episode, config);
      assert.equal(selected.model, expected[episode].model, episode);
      assert.equal(selected.reason, expected[episode].reason, episode);
    }
  });

  it("ignores blank repair override", () => {
    const selected = resolveModel("repair", {
      model: DEFAULT_MODEL,
      repairModel: "  ",
    });
    assert.equal(selected.model, DEFAULT_MODEL);
    assert.equal(selected.reason, "default");
  });

  it("records episode, model, and routing reason for traces", () => {
    const fields = routingTraceFields(
      resolveModel("repair", routingConfig(REPAIR_OVERRIDE)),
    );
    assert.deepEqual(fields, {
      episode: "repair",
      model: REPAIR_OVERRIDE,
      routingReason: "repair_override",
    });
    assert.equal("tools" in fields, false);
    assert.equal("maxTurns" in fields, false);
  });

  it("does not change tool set or write authority when a stronger repair model is selected", () => {
    const luna = tempToolConfig(DEFAULT_MODEL);
    const terra = {
      ...luna,
      model: REPAIR_OVERRIDE,
      repairModel: REPAIR_OVERRIDE,
    };
    const deniedArgs = JSON.stringify({
      path: "../tests/tasks.test.ts",
      content: "hacked",
    });

    assert.deepEqual(
      TOOL_DEFINITIONS.map((item) => item.name),
      ["list_files", "read_file", "write_file", "run_command"],
    );
    assert.deepEqual(
      READ_ONLY_TOOL_DEFINITIONS.map((item) => item.name),
      ["list_files", "read_file"],
    );
    assert.equal(resolveModel("repair", terra).model, REPAIR_OVERRIDE);

    const lunaDenied = executeTool(luna, "write_file", deniedArgs);
    const terraDenied = executeTool(terra, "write_file", deniedArgs);
    assert.equal(lunaDenied.ok, false);
    assert.equal(terraDenied.ok, false);
    assert.equal(lunaDenied.output, terraDenied.output);
  });
});

describe("R01 routing trial validity", () => {
  it("accepts the intended 404→500 normalized failure", () => {
    const failure = normalizeFailure({
      passed: false,
      exitCode: 1,
      durationMs: 10,
      output: R01_FAIL_OUTPUT,
    });
    assert.equal(isIntendedR01ControlledFailure(failure), true);
  });

  it("rejects a different failing test as contamination", () => {
    const failure = normalizeFailure({
      passed: false,
      exitCode: 1,
      durationMs: 10,
      output: `✖ list returns all tasks
  AssertionError [ERR_ASSERTION]: 2 !== 3`,
    });
    assert.equal(isIntendedR01ControlledFailure(failure), false);
  });

  it("marks a trial valid only after injected FAIL + intended failure + repair start", () => {
    const failure = normalizeFailure({
      passed: false,
      exitCode: 1,
      durationMs: 10,
      output: R01_FAIL_OUTPUT,
    });
    const valid: RoutingTrialEvidence = {
      injected: true,
      error: null,
      firstVerificationPassed: false,
      normalizedFailure: failure,
      repairStarted: true,
    };
    assert.equal(assessRoutingTrialValidity(valid).valid, true);

    assert.equal(
      assessRoutingTrialValidity({ ...valid, injected: false }).reason,
      "fault_not_injected",
    );
    assert.equal(
      assessRoutingTrialValidity({ ...valid, firstVerificationPassed: true })
        .reason,
      "first_verify_not_fail",
    );
    assert.equal(
      assessRoutingTrialValidity({ ...valid, normalizedFailure: null }).reason,
      "normalized_failure_missing",
    );
    assert.equal(
      assessRoutingTrialValidity({
        ...valid,
        normalizedFailure: normalizeFailure({
          passed: false,
          exitCode: 1,
          durationMs: 10,
          output:
            "✖ something else (0.1ms)\n  AssertionError [ERR_ASSERTION]: 1 !== 2",
        }),
      }).reason,
      "failure_not_intended_r01",
    );
    assert.equal(
      assessRoutingTrialValidity({ ...valid, repairStarted: false }).reason,
      "repair_did_not_start",
    );
  });
});
