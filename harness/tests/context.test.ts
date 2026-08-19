import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { HarnessConfig } from "../src/config.ts";
import {
  DiscoveryTracker,
  buildRepositoryMap,
  computePathOverlap,
  formatImplementationHints,
  formatSpecPhaseOrientation,
} from "../src/context.ts";
import { TOOL_DEFINITIONS } from "../src/tools.ts";

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-context-"));
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(path.join(targetSrcRoot, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(targetSrcRoot, "app.ts"),
    "export const ok = true;\n",
  );
  fs.writeFileSync(
    path.join(targetSrcRoot, "tasks", "task-routes.ts"),
    "export const routes = true;\n",
  );
  fs.mkdirSync(path.join(targetAppRoot, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(targetAppRoot, "tests", "tasks.test.ts"),
    "test('x', () => {});\n",
  );
  return {
    apiKey: "test",
    model: "test",
    maxTurns: 20,
    maxRepairAttempts: 2,
    repoRoot: root,
    targetAppRoot,
    targetSrcRoot,
    tracesDir: path.join(root, "traces"),
  };
}

describe("context preparation", () => {
  it("builds a deterministic bounded repository map without file contents", () => {
    const config = tempConfig();
    const first = buildRepositoryMap(config, { maxEntries: 16 });
    const second = buildRepositoryMap(config, { maxEntries: 16 });

    assert.deepEqual(first.map.entries, second.map.entries);
    assert.ok(first.map.entries.length <= 16);
    assert.ok(
      first.map.entries.some(
        (entry) => entry.path === "src/tasks/task-routes.ts",
      ),
    );
    assert.ok(first.durationMs >= 0);
    assert.ok(first.pathsScanned > 0);
  });

  it("formats orientation as hints, not edit instructions", () => {
    const config = tempConfig();
    const preparation = buildRepositoryMap(config);
    const text = formatSpecPhaseOrientation(preparation.map);

    assert.match(text, /orientation/i);
    assert.match(text, /not authoritative/i);
    assert.doesNotMatch(text, /Modify /);
    assert.doesNotMatch(text, /You must edit/i);
  });

  it("formats implementation hints without restricting access", () => {
    const config = tempConfig();
    const preparation = buildRepositoryMap(config);
    const text = formatImplementationHints({
      repositoryMap: preparation.map,
      specInspectedPaths: {
        readFiles: ["src/tasks/task-routes.ts"],
        listedPaths: ["."],
      },
    });

    assert.match(text, /authoritative execution intent/i);
    assert.match(text, /not an exhaustive scope/i);
    assert.match(text, /You may inspect any repository file/i);
    assert.doesNotMatch(text, /Modify task-routes/i);
  });
});

describe("discovery tracking", () => {
  it("records successful read/list paths separately by phase", () => {
    const tracker = new DiscoveryTracker();
    tracker.record("list_files", JSON.stringify({ path: "." }), "spec");
    tracker.record("read_file", JSON.stringify({ path: "src/app.ts" }), "spec");
    tracker.record("read_file", JSON.stringify({ path: "missing.ts" }), "spec");

    const metrics = tracker.toMetrics();
    assert.equal(metrics.listFilesCalls, 1);
    assert.equal(metrics.readFileCalls, 2);
    assert.deepEqual(metrics.listedPaths, ["."]);
    assert.deepEqual(metrics.readFilePaths, ["missing.ts", "src/app.ts"]);
  });

  it("counts implementation navigation calls before the first write", () => {
    const tracker = new DiscoveryTracker();
    tracker.record(
      "list_files",
      JSON.stringify({ path: "src" }),
      "implementation",
    );
    tracker.record(
      "read_file",
      JSON.stringify({ path: "src/app.ts" }),
      "implementation",
    );
    tracker.record(
      "write_file",
      JSON.stringify({ path: "app.ts", content: "x" }),
      "implementation",
    );
    tracker.record(
      "read_file",
      JSON.stringify({ path: "src/app.ts" }),
      "implementation",
    );

    assert.equal(tracker.getImplNavCallsBeforeFirstWrite(), 2);
  });

  it("computes read/list overlap between spec and implementation", () => {
    const overlap = computePathOverlap(
      {
        readFiles: ["src/a.ts", "src/b.ts"],
        listedPaths: ["."],
      },
      {
        readFiles: ["src/b.ts", "src/c.ts"],
        listedPaths: ["src"],
      },
    );

    assert.deepEqual(overlap.readFileOverlap, ["src/b.ts"]);
    assert.deepEqual(overlap.listedPathOverlap, []);
  });
});

describe("implementation tool availability", () => {
  it("still exposes write and discovery tools in the coding loop", () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    assert.ok(names.includes("list_files"));
    assert.ok(names.includes("read_file"));
    assert.ok(names.includes("write_file"));
    assert.ok(names.includes("run_command"));
  });
});
