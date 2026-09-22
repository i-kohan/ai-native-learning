import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT, loadConfig } from "../src/config.ts";
import {
  FAN_OUT_MAX_PARALLEL_WORKERS,
  type FanOutPlan,
  type FanOutUnit,
} from "../src/fan-out-plan.ts";
import {
  assertExactBaseProvenance,
  childExecutionInterval,
  cleanupFanOutWorkspaces,
  createFanOutWorkspaces,
  fanInChildDeltas,
  scheduleFanOutChildren,
  writeSetOverlap,
  type ChildArtifact,
} from "../src/fan-out.ts";
import { applySourceDelta, captureSourceDelta } from "../src/source-delta.ts";
import { prepareP03, samePreparedP03SourceState } from "../src/run-benchmark.ts";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  readWorkspaceHead,
  resolveBaseRevision,
} from "../src/workspace.ts";

const SERVICE = "target-app/src/tasks/task-service.ts";

describe("exact-base fan-out provenance", () => {
  it("creates child A, child B, and integration from one resolved SHA", () => {
    const baseRevision = resolveBaseRevision(REPO_ROOT);
    const workspaces = createFanOutWorkspaces({
      hostRepoRoot: REPO_ROOT,
      runId: `fanout-prov-${Date.now()}`,
      ref: baseRevision,
    });
    try {
      const provenance = assertExactBaseProvenance({
        baseRevision,
        children: workspaces.children,
        integration: workspaces.integration,
      });
      assert.equal(workspaces.baseRevision, baseRevision);
      assert.equal(workspaces.children.A.baseRevision, baseRevision);
      assert.equal(workspaces.children.B.baseRevision, baseRevision);
      assert.equal(workspaces.integration.baseRevision, baseRevision);
      assert.equal(readWorkspaceHead(workspaces.children.A.root), baseRevision);
      assert.equal(readWorkspaceHead(workspaces.children.B.root), baseRevision);
      assert.equal(
        readWorkspaceHead(workspaces.integration.root),
        baseRevision,
      );
      assert.equal(provenance.exactBase, true);
    } finally {
      cleanupFanOutWorkspaces(REPO_ROOT, workspaces);
    }
  });
});

describe("prepared P03 fixture equality", () => {
  it("gives child A, child B, and integration the same prepared source fingerprint", () => {
    const baseRevision = resolveBaseRevision(REPO_ROOT);
    const stamp = Date.now();
    const workspaces = createFanOutWorkspaces({
      hostRepoRoot: REPO_ROOT,
      runId: `fanout-prep-${stamp}`,
      ref: baseRevision,
    });
    try {
      const base = loadConfig();
      prepareP03(bindConfig(base, workspaces.integration));
      prepareP03(bindConfig(base, workspaces.children.A));
      prepareP03(bindConfig(base, workspaces.children.B));
      const prepared = samePreparedP03SourceState([
        path.join(workspaces.integration.root, "target-app/src"),
        path.join(workspaces.children.A.root, "target-app/src"),
        path.join(workspaces.children.B.root, "target-app/src"),
      ]);
      assert.equal(prepared.ok, true);
      assert.equal(prepared.fingerprint.length, 64);
    } finally {
      cleanupFanOutWorkspaces(REPO_ROOT, workspaces);
    }
  });
});

describe("source delta capture and deterministic fan-in", () => {
  it("captures a real Git source delta including added files and applies it", () => {
    const baseRevision = resolveBaseRevision(REPO_ROOT);
    const child = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `fanout-delta-child-${Date.now()}`,
      ref: baseRevision,
    });
    const integration = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `fanout-delta-int-${Date.now()}`,
      ref: baseRevision,
    });
    try {
      const added = path.join(child.root, "target-app/src/tasks/extra.ts");
      fs.writeFileSync(added, "export const extra = true;\n");
      appendServiceLine(child.root, "  // child-added-marker\n");
      const delta = captureSourceDelta({
        workspaceRoot: child.root,
        baseRevision,
      });
      assert.ok(delta.patch.includes("diff --git"));
      assert.ok(delta.patch.includes("index "));
      assert.ok(delta.changedFiles.includes("target-app/src/tasks/extra.ts"));
      assert.ok(delta.changedFiles.includes(SERVICE));

      const applied = applySourceDelta({
        workspaceRoot: integration.root,
        baseRevision,
        delta,
      });
      assert.equal(applied.ok, true);
      assert.equal(readWorkspaceHead(integration.root), baseRevision);
      assert.equal(
        fs.readFileSync(
          path.join(integration.root, "target-app/src/tasks/extra.ts"),
          "utf8",
        ),
        "export const extra = true;\n",
      );
      assert.match(
        fs.readFileSync(path.join(integration.root, SERVICE), "utf8"),
        /child-added-marker/,
      );
    } finally {
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: child });
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: integration });
    }
  });

  it("applies a child delta after fixture rewrite left the index stale", () => {
    const baseRevision = resolveBaseRevision(REPO_ROOT);
    const stamp = Date.now();
    const child = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `fanout-stale-child-${stamp}`,
      ref: baseRevision,
    });
    const integration = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `fanout-stale-int-${stamp}`,
      ref: baseRevision,
    });
    try {
      rewriteServiceLikeFixture(child.root);
      rewriteServiceLikeFixture(integration.root);
      appendServiceLine(child.root, "  // child-after-fixture\n");
      const delta = captureSourceDelta({
        workspaceRoot: child.root,
        baseRevision,
      });
      const applied = applySourceDelta({
        workspaceRoot: integration.root,
        baseRevision,
        delta,
      });
      assert.equal(applied.ok, true);
      const merged = fs.readFileSync(path.join(integration.root, SERVICE), "utf8");
      assert.match(merged, /fixture-rewrite/);
      assert.match(merged, /child-after-fixture/);
      assert.equal(readWorkspaceHead(integration.root), baseRevision);
    } finally {
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: child });
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: integration });
    }
  });

  it("integrates same-file non-overlapping edits and rejects incompatible overlap", () => {
    const baseRevision = resolveBaseRevision(REPO_ROOT);
    const stamp = Date.now();
    const childA = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `fanout-merge-a-${stamp}`,
      ref: baseRevision,
    });
    const childB = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `fanout-merge-b-${stamp}`,
      ref: baseRevision,
    });
    const childConflict = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `fanout-merge-c-${stamp}`,
      ref: baseRevision,
    });
    const integrationOk = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `fanout-merge-ok-${stamp}`,
      ref: baseRevision,
    });
    const integrationConflict = createWorkspace({
      hostRepoRoot: REPO_ROOT,
      id: `fanout-merge-bad-${stamp}`,
      ref: baseRevision,
    });
    try {
      replaceServiceRegion(childA.root, "complete(id: string)", "complete-a");
      replaceServiceRegion(childB.root, "reopen(id: string)", "reopen-b");
      replaceServiceRegion(
        childConflict.root,
        "complete(id: string)",
        "complete-conflict",
      );

      const deltaA = captureSourceDelta({
        workspaceRoot: childA.root,
        baseRevision,
      });
      const deltaB = captureSourceDelta({
        workspaceRoot: childB.root,
        baseRevision,
      });
      const deltaConflict = captureSourceDelta({
        workspaceRoot: childConflict.root,
        baseRevision,
      });

      const plan = frozenPlan(baseRevision);
      const compatible = fanInChildDeltas({
        plan,
        integration: integrationOk,
        children: [
          artifact("A", childA, deltaA),
          artifact("B", childB, deltaB),
        ],
      });
      assert.equal(compatible.ok, true);
      assert.deepEqual(compatible.appliedUnitIds, ["A", "B"]);
      assert.equal(compatible.conflict, null);
      const merged = fs.readFileSync(
        path.join(integrationOk.root, SERVICE),
        "utf8",
      );
      assert.match(merged, /complete-a/);
      assert.match(merged, /reopen-b/);
      assert.equal(readWorkspaceHead(integrationOk.root), baseRevision);
      assert.deepEqual(
        writeSetOverlap([
          artifact("A", childA, deltaA),
          artifact("B", childB, deltaB),
        ]),
        [SERVICE],
      );

      const conflicting = fanInChildDeltas({
        plan,
        integration: integrationConflict,
        children: [
          artifact("A", childA, deltaA),
          artifact("B", childConflict, deltaConflict),
        ],
      });
      assert.equal(conflicting.ok, false);
      assert.deepEqual(conflicting.appliedUnitIds, ["A"]);
      assert.equal(conflicting.conflict?.failedUnitId, "B");
      assert.match(
        conflicting.conflict?.evidence ?? "",
        /conflict|failed|error/i,
      );
      assert.equal(readWorkspaceHead(integrationConflict.root), baseRevision);
    } finally {
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: childA });
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: childB });
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: childConflict });
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace: integrationOk });
      cleanupWorkspace({
        hostRepoRoot: REPO_ROOT,
        workspace: integrationConflict,
      });
    }
  });
});

describe("fan-out schedule semantics", () => {
  it("runs sequential children one after another and awaits both parallel children", async () => {
    const events: string[] = [];
    const units = [unit("A"), unit("B")];
    await scheduleFanOutChildren({
      units,
      schedule: "sequential",
      runChild: async (current) => {
        events.push(`start:${current.id}`);
        await delay(20);
        events.push(`end:${current.id}`);
        return current.id;
      },
    });
    assert.deepEqual(events, ["start:A", "end:A", "start:B", "end:B"]);

    let started = 0;
    let bFinished = false;
    const parallel = await scheduleFanOutChildren({
      units,
      schedule: "parallel",
      runChild: async (current) => {
        started += 1;
        if (current.id === "A") {
          throw new Error("child A failed");
        }
        await waitUntil(() => started === 2);
        await delay(20);
        bFinished = true;
        return current.id;
      },
    });
    assert.equal(started, 2);
    assert.equal(bFinished, true);
    assert.equal(parallel[0].status, "rejected");
    assert.equal(parallel[1].status, "fulfilled");

    const interval = childExecutionInterval([
      artifactTimes("A", 100, 150),
      artifactTimes("B", 110, 180),
    ]);
    assert.equal(interval, 80);
  });
});

function frozenPlan(baseRevision: string): FanOutPlan {
  return {
    baseRevision,
    maxParallelWorkers: FAN_OUT_MAX_PARALLEL_WORKERS,
    integrationOrder: ["A", "B"],
    units: [unit("A"), unit("B")],
  };
}

function unit(id: string): FanOutUnit {
  return {
    id,
    intent: id === "A" ? "Title mutation" : "Task deletion",
    acceptanceRefs: [`unit ${id}`],
    verificationIntent: [`verify ${id}`],
    testFiles: [],
    dependsOn: [],
  };
}

function artifact(
  unitId: string,
  workspace: { root: string; baseRevision: string },
  delta: ReturnType<typeof captureSourceDelta>,
): ChildArtifact {
  return {
    unitId,
    workspaceRoot: workspace.root,
    baseRevision: workspace.baseRevision,
    changedFiles: delta.changedFiles,
    sourceDelta: delta,
    reviewDiff: "",
    verificationPassed: true,
    verificationOutput: "PASS",
    repairAttempts: 0,
    durationMs: 1,
    modelCalls: 0,
    toolCalls: 0,
    tokenUsage: null,
    startedAt: 1,
    finishedAt: 2,
  };
}

function artifactTimes(
  unitId: string,
  startedAt: number,
  finishedAt: number,
): ChildArtifact {
  return {
    unitId,
    workspaceRoot: "/tmp",
    baseRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    changedFiles: [],
    sourceDelta: {
      baseRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      format: "git-binary-full-index",
      patch: "",
      changedFiles: [],
    },
    reviewDiff: "",
    verificationPassed: true,
    verificationOutput: "",
    repairAttempts: 0,
    durationMs: finishedAt - startedAt,
    modelCalls: 0,
    toolCalls: 0,
    tokenUsage: null,
    startedAt,
    finishedAt,
  };
}

function rewriteServiceLikeFixture(workspaceRoot: string): void {
  const filePath = path.join(workspaceRoot, SERVICE);
  const current = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(
    filePath,
    current.replace("export class TaskService", "export class TaskService /* fixture-rewrite */"),
  );
}

function appendServiceLine(workspaceRoot: string, line: string): void {
  const filePath = path.join(workspaceRoot, SERVICE);
  fs.appendFileSync(filePath, line);
}

function replaceServiceRegion(
  workspaceRoot: string,
  needle: string,
  marker: string,
): void {
  const filePath = path.join(workspaceRoot, SERVICE);
  const current = fs.readFileSync(filePath, "utf8");
  if (!current.includes(needle)) {
    throw new Error(`Missing region ${needle}`);
  }
  fs.writeFileSync(
    filePath,
    current.replace(needle, `${needle} /* ${marker} */`),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) {
      throw new Error("timed out waiting for sibling start");
    }
    await delay(5);
  }
}
