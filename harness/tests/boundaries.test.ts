import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PathAccessError, resolveWithin } from "../src/paths.ts";
import { executeTool } from "../src/tools.ts";
import type { HarnessConfig } from "../src/config.ts";
import { REPO_ROOT } from "../src/config.ts";
import { prepareBenchmark } from "../src/run-benchmark.ts";

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tools-"));
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(path.join(targetSrcRoot, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(targetSrcRoot, "app.ts"),
    "export const ok = true;\n",
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

describe("path boundaries", () => {
  it("rejects path traversal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paths-"));
    assert.throws(() => resolveWithin(root, "../secret"), PathAccessError);
    assert.throws(
      () => resolveWithin(root, "foo/../../secret"),
      PathAccessError,
    );
  });

  it("allows nested paths inside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paths-"));
    const resolved = resolveWithin(root, "src/app.ts");
    assert.equal(resolved, path.resolve(root, "src/app.ts"));
  });
});

describe("tool boundaries", () => {
  it("write_file cannot escape target-app/src", () => {
    const config = tempConfig();
    const result = executeTool(
      config,
      "write_file",
      JSON.stringify({ path: "../package.json", content: "hacked" }),
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /traversal|escapes|not allowed/i);
  });

  it("run_command rejects arbitrary shell", () => {
    const config = tempConfig();
    const result = executeTool(
      config,
      "run_command",
      JSON.stringify({ command: "rm -rf /" }),
    );
    assert.equal(result.ok, false);
    assert.match(result.output, /not allowed/i);
  });

  it("read_file cannot read outside target-app", () => {
    const config = tempConfig();
    const result = executeTool(
      config,
      "read_file",
      JSON.stringify({ path: "../../.env" }),
    );
    assert.equal(result.ok, false);
  });
});

describe("benchmark setup", { concurrency: false }, () => {
  it("T01 starts with failing tests after setup patch", () => {
    const prep = prepareBenchmark("T01");
    assert.equal(prep.initialTestsPassed, false);
    assert.match(prep.task, /404/);
  });

  it("T02 starts with failing tests after setup patch", () => {
    const prep = prepareBenchmark("T02");
    assert.equal(prep.initialTestsPassed, false);
  });

  it("T03 starts with failing tests after setup patch", () => {
    const prep = prepareBenchmark("T03");
    assert.equal(prep.initialTestsPassed, false);
  });

  it("leaves target-app/src in clean fixture state", () => {
    prepareBenchmark("T04");
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "target-app/src/app.ts")));
    const routes = fs.readFileSync(
      path.join(REPO_ROOT, "target-app/src/tasks/task-routes.ts"),
      "utf8",
    );
    assert.match(routes, /status: 404, body: \{ error: "task_not_found" \}/);
    assert.doesNotMatch(
      routes,
      /status: 500, body: \{ error: "task_not_found" \}/,
    );
  });
});
