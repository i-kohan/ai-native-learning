import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT, type HarnessConfig } from "../src/config.ts";
import { snapshotDirectory } from "../src/diff.ts";
import { runIsolationProbe } from "../src/iso01.ts";
import { runFinalVerification } from "../src/verify.ts";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  isWorkspacePresent,
  resolveBaseRevision,
} from "../src/workspace.ts";

function unusedConfig(): HarnessConfig {
  return {
    apiKey: "unused",
    model: "unused",
    maxTurns: 0,
    maxRepairAttempts: 2,
    maxReviewRepairAttempts: 1,
    repoRoot: REPO_ROOT,
    targetAppRoot: path.join(REPO_ROOT, "target-app"),
    targetSrcRoot: path.join(REPO_ROOT, "target-app", "src"),
    tracesDir: path.join(REPO_ROOT, "traces"),
  };
}

describe("workspace isolation", () => {
  it("binds harness roots to the worktree and keeps traces on the host", () => {
    const id = `bind-${Date.now()}`;
    const workspace = createWorkspace({ hostRepoRoot: REPO_ROOT, id });
    try {
      const config = bindConfig(unusedConfig(), workspace);
      assert.equal(config.repoRoot, workspace.root);
      assert.equal(
        config.targetAppRoot,
        path.join(workspace.root, "target-app"),
      );
      assert.equal(
        config.targetSrcRoot,
        path.join(workspace.root, "target-app", "src"),
      );
      assert.equal(config.tracesDir, path.join(REPO_ROOT, "traces"));
      assert.notEqual(config.repoRoot, REPO_ROOT);
    } finally {
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
    }
  });

  it("cleans up a worktree and is safe to retry", () => {
    const id = `cleanup-${Date.now()}`;
    const workspace = createWorkspace({ hostRepoRoot: REPO_ROOT, id });
    assert.equal(isWorkspacePresent(REPO_ROOT, workspace.root), true);
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
    assert.equal(isWorkspacePresent(REPO_ROOT, workspace.root), false);
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
    assert.equal(isWorkspacePresent(REPO_ROOT, workspace.root), false);
  });
});

describe("ISO01 mechanism probe", () => {
  it("proves two workspaces from the same SHA stay independent", () => {
    const hostSrc = path.join(REPO_ROOT, "target-app", "src");
    const mainBefore = snapshotDirectory(hostSrc);
    const c0 = resolveBaseRevision(REPO_ROOT);

    const result = runIsolationProbe();

    assert.equal(result.taskKind, "mechanism_probe");
    assert.equal(result.mechanism, "workspace_isolation");
    assert.equal(result.baseRevision, c0);
    assert.equal(result.workspaceA.baseRevision, c0);
    assert.equal(result.workspaceB.baseRevision, c0);
    assert.equal(result.initiallyEquivalent, true);
    assert.equal(result.mutationObservedInA, true);
    assert.equal(result.mutationAbsentInB, true);
    assert.equal(result.mainCheckoutUnchanged, true);
    assert.equal(result.verifierA.passed, false);
    assert.equal(result.verifierB.passed, true);
    assert.equal(result.cleanedUp, true);
    assert.equal(result.cleanupRetrySafe, true);
    assert.equal(result.passed, true);
    assert.equal(isWorkspacePresent(REPO_ROOT, result.workspaceA.root), false);
    assert.equal(isWorkspacePresent(REPO_ROOT, result.workspaceB.root), false);
    assert.deepEqual(snapshotDirectory(hostSrc), mainBefore);

    const hostVerify = runFinalVerification(unusedConfig());
    assert.equal(hostVerify.passed, true);
    assert.ok(fs.existsSync(result.evidencePath));
  });
});
