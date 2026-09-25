import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT, type HarnessConfig } from "../src/config.ts";
import { runAgentLoop, type ResponsesCreateFn } from "../src/loop.ts";
import {
  admitMemory,
  formatMemoryHint,
  observeImplementationSurface,
  promoteVerifiedMemory,
  proposeMemoryCandidate,
  retrieveWorkerMemory,
  type MemoryCandidate,
} from "../src/memory.ts";
import {
  listMemoryRecords,
  loadMemoryRecord,
  MemoryStoreError,
  parseMemoryRecord,
  saveMemoryRecord,
} from "../src/memory-store.ts";
import { TOOL_DEFINITIONS } from "../src/tools.ts";
import { parseWorkflowState } from "../src/workflow-state.ts";
import {
  initializeWorkflow,
  workflowStatePath,
} from "../src/workflow-store.ts";

const SOURCE = "target-app/src/tasks/task-service.ts";

describe("implementation-surface observation", () => {
  it("derives the current repository TaskService fact from source", () => {
    const observed = observeImplementationSurface(REPO_ROOT);
    assert.ok(observed);
    assert.equal(observed.anchor, "TaskService");
    assert.equal(observed.sourcePath, SOURCE);
    assert.equal(
      observed.statement,
      `Core task-domain operations are implemented by TaskService in ${SOURCE}`,
    );
    assert.deepEqual(observed.operations, [
      "complete",
      "create",
      "get",
      "list",
      "reopen",
    ]);
  });

  it("names the class and file it actually finds", () => {
    const repo = tempRepo();
    writeSurface(repo, {
      anchor: "TaskOps",
      fileName: "task-ops.ts",
      operations: ["create", "list"],
    });
    const observed = observeImplementationSurface(repo);
    assert.ok(observed);
    assert.equal(observed.anchor, "TaskOps");
    assert.equal(observed.sourcePath, "target-app/src/tasks/task-ops.ts");
    assert.equal(observed.anchor, "TaskOps");
  });
});

describe("memory admission", () => {
  it("admits one record only from supported evidence that matches the repository", () => {
    const repo = tempRepo();
    writeSurface(repo, {
      anchor: "TaskService",
      fileName: "task-service.ts",
      operations: ["create", "list"],
    });
    const candidate = proposeMemoryCandidate({
      repoRoot: repo,
      repositoryScope: "repo-a",
      baseRevision: "abc123",
      originatingWorkflowId: "wf-1",
      originatingRunId: "run-1",
      observedAt: "2026-09-25T12:00:00.000Z",
      evidence: verifiedEvidence(),
    });
    assert.ok(candidate);
    assert.equal(candidate.claim.anchor, "TaskService");
    const admitted = admitMemory(candidate, repo);
    assert.equal(admitted.ok, true);
    if (!admitted.ok) {
      return;
    }
    assert.equal(admitted.record.status, "admitted");
    assert.equal(admitted.record.evidence.reviewOutcome, "pass");
    assert.equal(admitted.record.originatingRunId, "run-1");
  });

  it("does not propose a candidate from an unverified outcome", () => {
    const repo = tempRepo();
    writeSurface(repo, {
      anchor: "TaskService",
      fileName: "task-service.ts",
      operations: ["create"],
    });
    assert.equal(
      proposeMemoryCandidate({
        repoRoot: repo,
        repositoryScope: "repo-a",
        baseRevision: "abc123",
        originatingWorkflowId: "wf-1",
        originatingRunId: "run-1",
        evidence: {
          workflowStatus: "success",
          verificationPassed: true,
          reviewOutcome: "skipped",
        },
      }),
      null,
    );
  });

  it("rejects a claim that does not match the observed surface", () => {
    const repo = tempRepo();
    writeSurface(repo, {
      anchor: "TaskService",
      fileName: "task-service.ts",
      operations: ["create"],
    });
    const candidate = proposeMemoryCandidate({
      repoRoot: repo,
      repositoryScope: "repo-a",
      baseRevision: "abc123",
      originatingWorkflowId: "wf-1",
      originatingRunId: "run-1",
      observedAt: "2026-09-25T12:00:00.000Z",
      evidence: verifiedEvidence(),
    });
    assert.ok(candidate);
    const rewritten = {
      ...candidate,
      claim: {
        ...candidate.claim,
        statement: "The model says the implementation lives in task-service.ts",
      },
    } as MemoryCandidate;
    const admitted = admitMemory(rewritten, repo);
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.equal(admitted.reason, "claim_mismatch");
    }
  });
});

describe("memory store and retrieval", () => {
  it("persists and reloads an admitted record", () => {
    const { repo, store } = admittedFixture("repo-a");
    const records = listMemoryRecords(store);
    assert.equal(records.length, 1);
    const loaded = loadMemoryRecord(store, records[0].id);
    assert.deepEqual(loaded, records[0]);
    assert.equal(loaded.sourcePath, SOURCE);
    assert.equal(observeImplementationSurface(repo)?.anchor, "TaskService");
  });

  it("refuses to rewrite an admitted record", () => {
    const { store } = admittedFixture("repo-a");
    const original = listMemoryRecords(store)[0];
    assert.throws(
      () =>
        saveChanged(store, {
          ...original,
          observedAt: "2026-09-25T13:00:00.000Z",
        }),
      (error: unknown) => error instanceof MemoryStoreError,
    );
    assert.equal(
      loadMemoryRecord(store, original.id).observedAt,
      original.observedAt,
    );
  });

  it("retrieves only the requested repository scope", () => {
    const repo = tempRepo();
    writeSurface(repo, {
      anchor: "TaskService",
      fileName: "task-service.ts",
      operations: ["create", "list"],
    });
    const store = fs.mkdtempSync(path.join(os.tmpdir(), "mem-scope-"));
    admitTo(store, repo, "repo-a", "run-a");
    admitTo(store, repo, "repo-b", "run-b");
    const retrieval = retrieveWorkerMemory({
      storeDir: store,
      repositoryScope: "repo-a",
      repoRoot: repo,
    });
    assert.equal(retrieval.metrics.memoryRetrieved, 1);
    assert.equal(retrieval.ignoredOutOfScope, 1);
    assert.equal(retrieval.metrics.memoryInjected, 1);
    assert.equal(retrieval.retrievedIds.length, 1);
    const loaded = loadMemoryRecord(store, retrieval.retrievedIds[0]);
    assert.equal(loaded.repositoryScope, "repo-a");
  });

  it("injects one hint when the current surface still supports the claim", () => {
    const { repo, store, record } = admittedFixture("repo-a");
    fs.appendFileSync(path.join(repo, SOURCE), "\n// harmless comment\n");
    const retrieval = retrieveWorkerMemory({
      storeDir: store,
      repositoryScope: "repo-a",
      repoRoot: repo,
    });
    assert.equal(retrieval.metrics.memoryValidated, 1);
    assert.equal(retrieval.metrics.memoryRejectedStale, 0);
    assert.equal(retrieval.metrics.memoryInjected, 1);
    assert.ok(retrieval.hint);
    assert.equal(
      retrieval.metrics.injectedBytes,
      Buffer.byteLength(retrieval.hint, "utf8"),
    );
    assert.equal(
      retrieval.metrics.injectedTokensEstimate,
      Math.ceil(retrieval.metrics.injectedBytes / 4),
    );
    assert.match(retrieval.hint, /not authoritative/);
    assert.match(retrieval.hint, /list_files and read_file/);
    assert.equal(retrieval.hint, formatMemoryHint(record));
    const current = observeImplementationSurface(repo);
    assert.ok(current);
    assert.notEqual(current.sourceFingerprint, record.sourceFingerprint);
    assert.equal(
      loadMemoryRecord(store, record.id).sourceFingerprint,
      record.sourceFingerprint,
    );
  });

  it("rejects stale memory and does not inject it", () => {
    const { repo, store, record } = admittedFixture("repo-a");
    fs.writeFileSync(path.join(repo, SOURCE), "export const removed = true;\n");
    const retrieval = retrieveWorkerMemory({
      storeDir: store,
      repositoryScope: "repo-a",
      repoRoot: repo,
    });
    assert.equal(retrieval.hint, null);
    assert.equal(retrieval.metrics.memoryValidated, 0);
    assert.equal(retrieval.metrics.memoryRejectedStale, 1);
    assert.equal(retrieval.metrics.memoryInjected, 0);
    assert.equal(retrieval.metrics.injectedBytes, 0);
    assert.equal(retrieval.rejectedStale[0]?.reason, "anchor_missing");
    assert.equal(
      loadMemoryRecord(store, record.id).claim.anchor,
      "TaskService",
    );
    assert.ok(TOOL_DEFINITIONS.some((tool) => tool.name === "list_files"));
    assert.ok(TOOL_DEFINITIONS.some((tool) => tool.name === "read_file"));
  });

  it("does not inject when more than one in-scope record validates", () => {
    const { repo, store, record } = admittedFixture("repo-a");
    saveMemoryRecord(store, {
      ...record,
      id: "mem-0123456789abcdef",
    });
    const retrieval = retrieveWorkerMemory({
      storeDir: store,
      repositoryScope: "repo-a",
      repoRoot: repo,
    });
    assert.equal(retrieval.metrics.memoryValidated, 2);
    assert.equal(retrieval.hint, null);
    assert.equal(retrieval.metrics.memoryInjected, 0);
  });
});

describe("memory does not modify workflow state", () => {
  it("leaves a WorkflowState file unchanged and rejects memory as workflow state", () => {
    const { repo, store } = admittedFixture("repo-a");
    const workflowDir = fs.mkdtempSync(path.join(os.tmpdir(), "mem-wf-"));
    initializeWorkflow({
      storeDir: workflowDir,
      workflowId: "wf-memory",
      task: "task",
      workspace: {
        id: "wf-test",
        root: repo,
        baseRevision: "abc123",
        ref: "HEAD",
        headRevision: "abc123",
        workingTreeFingerprint: "fingerprint",
      },
    });
    const statePath = workflowStatePath(workflowDir, "wf-memory");
    const before = fs.readFileSync(statePath, "utf8");
    retrieveWorkerMemory({
      storeDir: store,
      repositoryScope: "repo-a",
      repoRoot: repo,
    });
    promoteVerifiedMemory({
      storeDir: store,
      repoRoot: repo,
      repositoryScope: "repo-a",
      baseRevision: "abc123",
      originatingWorkflowId: "wf-memory",
      originatingRunId: "run-2",
      observedAt: "2026-09-25T12:00:00.000Z",
      evidence: verifiedEvidence(),
    });
    assert.equal(fs.readFileSync(statePath, "utf8"), before);
    const memory = listMemoryRecords(store)[0];
    const parsed = parseWorkflowState(memory);
    assert.equal(parsed.ok, false);
    assert.equal(
      parseMemoryRecord({ ...memory, modelText: "trust me" }).ok,
      false,
    );
  });
});

describe("worker memory hint", () => {
  it("enters implementation context without removing repository discovery tools", async () => {
    const hint = [
      "## Repository memory (advisory hint)",
      "Claim: Core task-domain operations are implemented by TaskService in target-app/src/tasks/task-service.ts",
    ].join("\n");
    const create = scriptedCreate([
      {
        id: "resp-1",
        output: [
          { type: "message", content: [{ type: "output_text", text: "done" }] },
        ],
        output_text: "done",
      },
    ]);
    await runAgentLoop({
      config: tempConfig(),
      task: "implement the spec",
      runId: "mem-hint",
      phase: "implementation",
      conversationStateMode: "manual",
      memoryHint: hint,
      responsesCreate: create,
    });
    const request = create.requests[0];
    assert.ok(request);
    const payload = JSON.stringify(request.input);
    assert.match(payload, /Repository memory/);
    assert.match(payload, /TaskService/);
    assert.equal(request.previous_response_id, undefined);
    const tools = JSON.stringify(request.tools);
    assert.match(tools, /list_files/);
    assert.match(tools, /read_file/);
  });
});

function admittedFixture(scope: string): {
  repo: string;
  store: string;
  record: ReturnType<typeof listMemoryRecords>[number];
} {
  const repo = tempRepo();
  writeSurface(repo, {
    anchor: "TaskService",
    fileName: "task-service.ts",
    operations: ["create", "list"],
  });
  const store = fs.mkdtempSync(path.join(os.tmpdir(), "mem-store-"));
  const record = admitTo(store, repo, scope, "run-1");
  return { repo, store, record };
}

function admitTo(store: string, repo: string, scope: string, runId: string) {
  const promotion = promoteVerifiedMemory({
    storeDir: store,
    repoRoot: repo,
    repositoryScope: scope,
    baseRevision: "abc123",
    originatingWorkflowId: "wf-1",
    originatingRunId: runId,
    observedAt: "2026-09-25T12:00:00.000Z",
    evidence: verifiedEvidence(),
  });
  assert.ok(promotion.record);
  return promotion.record;
}

function verifiedEvidence() {
  return {
    workflowStatus: "success" as const,
    verificationPassed: true as const,
    reviewOutcome: "pass" as const,
  };
}

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mem-repo-"));
}

function writeSurface(
  repoRoot: string,
  options: { anchor: string; fileName: string; operations: string[] },
): void {
  const dir = path.join(repoRoot, "target-app", "src", "tasks");
  fs.mkdirSync(dir, { recursive: true });
  const calls = options.operations
    .map((operation) => `  service.${operation}();`)
    .join("\n");
  const methods = options.operations
    .map((operation) => `  ${operation}(): void {}`)
    .join("\n");
  fs.writeFileSync(
    path.join(dir, "task-routes.ts"),
    `import type { ${options.anchor} } from "./${options.fileName}";

export function createTaskRoutes(service: ${options.anchor}) {
${calls}
}
`,
  );
  fs.writeFileSync(
    path.join(dir, options.fileName),
    `export class ${options.anchor} {
${methods}
}
`,
  );
}

function saveChanged(
  store: string,
  record: ReturnType<typeof listMemoryRecords>[number],
): void {
  saveMemoryRecord(store, record);
}

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mem-loop-"));
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(targetSrcRoot, { recursive: true });
  return {
    apiKey: "test",
    model: "test-model",
    maxTurns: 2,
    maxRepairAttempts: 1,
    maxReviewRepairAttempts: 1,
    repoRoot: root,
    targetAppRoot,
    targetSrcRoot,
    tracesDir: path.join(root, "traces"),
  };
}

function scriptedCreate(
  script: Array<Record<string, unknown>>,
): ResponsesCreateFn & { requests: Array<Record<string, unknown>> } {
  const requests: Array<Record<string, unknown>> = [];
  const create = Object.assign(
    async (request: Record<string, unknown>) => {
      requests.push(request);
      const next = script[requests.length - 1];
      if (!next) {
        throw new Error("unexpected extra Responses call");
      }
      return next;
    },
    { requests },
  );
  return create as unknown as ResponsesCreateFn & {
    requests: Array<Record<string, unknown>>;
  };
}
