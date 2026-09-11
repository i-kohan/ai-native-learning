import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT, type HarnessConfig } from "../src/config.ts";
import { runV1Harness } from "../src/run.ts";
import {
  cleanupWorkspace,
  createWorkspace,
  captureWorkspaceResumeEvidence,
} from "../src/workspace.ts";
import { WorkflowError } from "../src/workflow-error.ts";
import {
  initializeWorkflow,
  loadWorkflowState,
  saveWorkflowState,
  workflowStatePath,
} from "../src/workflow-store.ts";
import {
  admitImplementationReady,
  admitTerminal,
  createSpecRequiredState,
  nextDurableAction,
  parseWorkflowState,
  type WorkflowState,
} from "../src/workflow-state.ts";
import type { Spec, SpecDecision } from "../src/spec.ts";

function sampleSpec(): Spec {
  return {
    goal: "Keep completedAt in sync",
    requirements: ["Set completedAt on complete"],
    constraints: ["Do not modify tests"],
    nonGoals: ["New features"],
    acceptance: ["Existing tests pass"],
    verification: ["npm test"],
    ambiguities: [],
  };
}

function executableDecision(): Extract<SpecDecision, { status: "executable" }> {
  return { status: "executable", spec: sampleSpec() };
}

function dummyWorkspaceEvidence(root: string) {
  return {
    id: "wf-test",
    root,
    baseRevision: "abc123",
    ref: "HEAD",
    headRevision: "abc123",
    workingTreeFingerprint: "fingerprint",
  };
}

function unusedConfig(tracesDir: string): HarnessConfig {
  return {
    apiKey: "unused",
    model: "unused",
    maxTurns: 1,
    maxRepairAttempts: 2,
    maxReviewRepairAttempts: 1,
    repoRoot: REPO_ROOT,
    targetAppRoot: path.join(REPO_ROOT, "target-app"),
    targetSrcRoot: path.join(REPO_ROOT, "target-app", "src"),
    tracesDir,
  };
}

describe("WorkflowState admission", () => {
  it("runs Spec from spec_required and continues implementation from implementation_ready", () => {
    const current = createSpecRequiredState({
      workflowId: "wf-1",
      task: "do the thing",
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
    });
    assert.equal(nextDurableAction(current), "run_spec");
    const ready = admitImplementationReady({
      current,
      decision: executableDecision(),
      specInspectedPaths: { readFiles: ["src/app.ts"], listedPaths: [] },
      contextMode: "variant",
    });
    assert.equal(ready.phase, "implementation_ready");
    assert.equal(nextDurableAction(ready), "continue_implementation");
    assert.equal(ready.spec.goal, sampleSpec().goal);
  });

  it("rejects illegal transitions", () => {
    const ready = admitImplementationReady({
      current: createSpecRequiredState({
        workflowId: "wf-1",
        task: "do the thing",
        workspace: dummyWorkspaceEvidence("/tmp/ws"),
      }),
      decision: executableDecision(),
      specInspectedPaths: { readFiles: [], listedPaths: [] },
      contextMode: "variant",
    });
    assert.throws(
      () =>
        admitImplementationReady({
          current: ready,
          decision: executableDecision(),
          specInspectedPaths: { readFiles: [], listedPaths: [] },
          contextMode: "variant",
        }),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "illegal_transition",
    );
    const terminal = admitTerminal({
      current: ready,
      outcome: { workflowStatus: "success" },
    });
    assert.equal(nextDurableAction(terminal), "reject_terminal");
    assert.throws(
      () =>
        admitTerminal({
          current: terminal,
          outcome: { workflowStatus: "failure" },
        }),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "illegal_transition",
    );
  });
});

describe("WorkflowState persistence", () => {
  it("fails closed on missing, corrupt, and unsupported state", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-store-"));
    assert.throws(
      () => loadWorkflowState(storeDir, "missing"),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "missing_state",
    );

    const dest = workflowStatePath(storeDir, "corrupt");
    fs.writeFileSync(dest, "{not-json");
    assert.throws(
      () => loadWorkflowState(storeDir, "corrupt"),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "corrupt_state",
    );

    const unsupportedSchema: WorkflowState = createSpecRequiredState({
      workflowId: "schema",
      task: "task",
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
    });
    fs.writeFileSync(
      workflowStatePath(storeDir, "schema"),
      `${JSON.stringify({ ...unsupportedSchema, schemaVersion: 99 })}\n`,
    );
    assert.throws(
      () => loadWorkflowState(storeDir, "schema"),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "unsupported_schema",
    );

    fs.writeFileSync(
      workflowStatePath(storeDir, "phase"),
      `${JSON.stringify({ ...unsupportedSchema, workflowId: "phase", phase: "worker_running" })}\n`,
    );
    assert.throws(
      () => loadWorkflowState(storeDir, "phase"),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "unsupported_phase",
    );
  });

  it("treats crash before persist as previous phase and crash after persist as the new phase", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-commit-"));
    const initial = initializeWorkflow({
      storeDir,
      workflowId: "commit",
      task: "task",
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
    });
    assert.equal(loadWorkflowState(storeDir, "commit").phase, "spec_required");

    const next = admitImplementationReady({
      current: initial,
      decision: executableDecision(),
      specInspectedPaths: { readFiles: ["a.ts"], listedPaths: [] },
      contextMode: "variant",
    });
    assert.equal(
      loadWorkflowState(storeDir, "commit").phase,
      "spec_required",
      "crash before durable commit keeps spec_required",
    );

    saveWorkflowState(storeDir, next);
    const loaded = loadWorkflowState(storeDir, "commit");
    assert.equal(loaded.phase, "implementation_ready");
    assert.equal(nextDurableAction(loaded), "continue_implementation");
  });

  it("atomically replaces the workflow-state file", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-atomic-"));
    const initial = initializeWorkflow({
      storeDir,
      workflowId: "atomic",
      task: "task",
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
    });
    saveWorkflowState(
      storeDir,
      admitImplementationReady({
        current: initial,
        decision: executableDecision(),
        specInspectedPaths: { readFiles: [], listedPaths: [] },
        contextMode: "variant",
      }),
    );
    const parsed = parseWorkflowState(
      JSON.parse(
        fs.readFileSync(workflowStatePath(storeDir, "atomic"), "utf8"),
      ),
    );
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.phase, "implementation_ready");
    }
    const leftovers = fs
      .readdirSync(storeDir)
      .filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });
});

describe("durable resume workspace binding", () => {
  it("fails closed when persisted workspace is missing or the working tree disagrees", async () => {
    const id = `dur-ws-${Date.now()}`;
    const workspace = createWorkspace({ hostRepoRoot: REPO_ROOT, id });
    try {
      const evidence = captureWorkspaceResumeEvidence(workspace);
      const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-bind-"));
      initializeWorkflow({
        storeDir,
        workflowId: "ws-bind",
        task: "task",
        workspace: evidence,
      });

      const missing = createSpecRequiredState({
        workflowId: "missing-ws",
        task: "task",
        workspace: {
          ...evidence,
          root: path.join(os.tmpdir(), "no-such-workspace"),
          id: "missing-ws",
        },
      });
      saveWorkflowState(storeDir, missing);
      await assert.rejects(
        () =>
          runV1Harness({
            config: unusedConfig(storeDir),
            task: "task",
            runId: "missing-ws-run",
            durable: { workflowId: "missing-ws", storeDir },
          }),
        (error: unknown) =>
          error instanceof WorkflowError && error.code === "workspace_missing",
      );

      const mismatch = createSpecRequiredState({
        workflowId: "mismatch-ws",
        task: "task",
        workspace: { ...evidence, workingTreeFingerprint: "not-the-tree" },
      });
      saveWorkflowState(storeDir, mismatch);
      await assert.rejects(
        () =>
          runV1Harness({
            config: unusedConfig(storeDir),
            task: "task",
            runId: "mismatch-ws-run",
            durable: { workflowId: "mismatch-ws", storeDir },
          }),
        (error: unknown) =>
          error instanceof WorkflowError && error.code === "workspace_mismatch",
      );
    } finally {
      cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
    }
  });
});

describe("durable run.ts gates", () => {
  it("rejects resuming a terminal workflow", async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-term-"));
    const initial = initializeWorkflow({
      storeDir,
      workflowId: "term",
      task: "task",
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
    });
    saveWorkflowState(
      storeDir,
      admitTerminal({
        current: initial,
        outcome: { workflowStatus: "success" },
      }),
    );
    await assert.rejects(
      () =>
        runV1Harness({
          config: unusedConfig(storeDir),
          task: "task",
          runId: "term-run",
          durable: { workflowId: "term", storeDir },
        }),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "terminal_resume",
    );
  });

  it("rejects experimental modes that would make resume ambiguous", async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mode-"));
    await assert.rejects(
      () =>
        runV1Harness({
          config: unusedConfig(storeDir),
          task: "task",
          runId: "mode-run",
          planningEnabled: true,
          durable: { workflowId: "mode", storeDir },
        }),
      (error: unknown) =>
        error instanceof WorkflowError && error.code === "unsupported_mode",
    );
  });
});

describe("durable process boundary", () => {
  it("loads committed implementation_ready from a distinct process", () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-pid-"));
    const initial = initializeWorkflow({
      storeDir,
      workflowId: "pid",
      task: "task",
      workspace: dummyWorkspaceEvidence("/tmp/ws"),
    });
    saveWorkflowState(
      storeDir,
      admitImplementationReady({
        current: initial,
        decision: executableDecision(),
        specInspectedPaths: { readFiles: ["x.ts"], listedPaths: [] },
        contextMode: "variant",
      }),
    );
    const statePath = workflowStatePath(storeDir, "pid");
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        "const fs=require('fs'); const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(JSON.stringify({pid:process.pid,workflowId:s.workflowId,phase:s.phase}))",
        statePath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    const payload = JSON.parse(child.stdout) as {
      pid: number;
      workflowId: string;
      phase: string;
    };
    assert.notEqual(payload.pid, process.pid);
    assert.equal(payload.workflowId, "pid");
    assert.equal(payload.phase, "implementation_ready");
  });
});
