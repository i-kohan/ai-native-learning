import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { admitCurrentHeadCi, classifyCiEvidence } from "../src/ci-admission.ts";
import { acceptDeliveryCandidate } from "../src/delivery-accept.ts";
import { DeliveryError } from "../src/delivery-error.ts";
import {
  gitPushArgs,
  assertNoForcePush,
  deliveryGitEnv,
} from "../src/delivery-git.ts";
import { gitRefUpdateBody } from "../src/github-client.ts";
import { runDelivery } from "../src/delivery-run.ts";
import { seedSuccessfulTerminalWorkflow } from "../src/delivery-seed.ts";
import {
  admitHeadCommitted,
  admitReadyForHumanReview,
  assertSafeDeliveryBranch,
  createLocalAcceptedDelivery,
  deliveryBranchFor,
  type CiObservation,
  type DeliveryState,
} from "../src/delivery-state.ts";
import {
  loadDeliveryState,
  saveDeliveryStateUnfenced,
} from "../src/delivery-store.ts";
import type { DeliveryGit } from "../src/delivery-git.ts";
import type {
  GitHubClient,
  GitHubPull,
  GitHubWorkflowRun,
} from "../src/github-client.ts";
import { reconcileDraftPull } from "../src/github-delivery.ts";
import { decideRemoteBranchAction } from "../src/github-delivery.ts";
import { redactSecrets } from "../src/github-redact.ts";
import { GHI01_SPEC } from "../src/ghi01-task.ts";
import { Tracer } from "../src/trace.ts";
import { verificationChildEnv } from "../src/verify.ts";
import type { HarnessConfig } from "../src/config.ts";
import { snapshotDirectory } from "../src/diff.ts";

const BASE = "d".repeat(40);
const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const OTHER = "c".repeat(40);

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function dummyConfig(root: string): HarnessConfig {
  const targetAppRoot = path.join(root, "target-app");
  return {
    apiKey: "test-key",
    model: "test-model",
    maxTurns: 4,
    maxRepairAttempts: 1,
    maxReviewRepairAttempts: 1,
    repoRoot: root,
    targetAppRoot,
    targetSrcRoot: path.join(targetAppRoot, "src"),
    tracesDir: path.join(root, "traces"),
  };
}

function dummyWorkspace(root: string, workflowId: string) {
  return {
    id: workflowId,
    root,
    baseRevision: BASE,
    ref: "HEAD",
    headRevision: BASE,
    workingTreeFingerprint: "fingerprint",
  };
}

function observation(partial: Partial<CiObservation> = {}): CiObservation {
  return {
    repository: "i-kohan/ai-native-learning",
    prNumber: 7,
    headSha: H1,
    workflow: "CI",
    job: "test",
    failedStep: null,
    conclusion: "success",
    failureClass: "success",
    evidenceExcerpt: "ok",
    ...partial,
  };
}

function seedDelivery(storeDir: string, workflowId: string): DeliveryState {
  const workspaceRoot = path.join(storeDir, "ws");
  fs.mkdirSync(path.join(workspaceRoot, "target-app", "src"), {
    recursive: true,
  });
  const baseline = snapshotDirectory(
    path.join(workspaceRoot, "target-app", "src"),
  );
  const seeded = seedSuccessfulTerminalWorkflow({
    storeDir,
    workflowId,
    task: "Add DELETE /tasks/:id",
    spec: GHI01_SPEC,
    workspace: dummyWorkspace(workspaceRoot, workflowId),
    baseline,
  });
  const created = createLocalAcceptedDelivery({
    workflowId,
    repository: "i-kohan/ai-native-learning",
    issueNumber: 11,
    issueUrl: "https://github.com/i-kohan/ai-native-learning/issues/11",
    defaultBranch: "main",
    baseSha: BASE,
    spec: GHI01_SPEC,
    reviewBaseline: seeded.reviewBaseline,
    workspace: dummyWorkspace(workspaceRoot, workflowId),
    task: "Add DELETE /tasks/:id",
  });
  saveDeliveryStateUnfenced(storeDir, created);
  return created;
}

function mockGit(sequence: string[]): DeliveryGit {
  let index = 0;
  return {
    revParse: () => sequence[Math.max(0, index - 1)] ?? BASE,
    commitAcceptedTree: () => {
      const sha = sequence[index] ?? sequence[sequence.length - 1];
      index += 1;
      return sha;
    },
    pushBranch: () => undefined,
  };
}

function mockGithub(options?: {
  remote?: { sha: string } | null;
  pulls?: GitHubPull[];
  createPull?: () => Promise<GitHubPull>;
  runs?: GitHubWorkflowRun[];
  jobLog?: string;
}): GitHubClient & { createPullCalls: number } {
  let remote = options?.remote === undefined ? null : options.remote;
  let pulls = options?.pulls ? [...options.pulls] : [];
  const createPullCalls = { value: 0 };
  const client: GitHubClient & { createPullCalls: number } = {
    createPullCalls: 0,
    getRepository: async () => ({ defaultBranch: "main" }),
    getRef: async () => remote,
    createRef: async (_branch, sha) => {
      remote = { sha };
    },
    updateRef: async (_branch, sha) => {
      remote = { sha };
    },
    listPulls: async () => pulls,
    createDraftPull: async () => {
      createPullCalls.value += 1;
      client.createPullCalls = createPullCalls.value;
      if (options?.createPull) {
        const pull = await options.createPull();
        pulls = [pull];
        return pull;
      }
      const pull: GitHubPull = {
        number: 7,
        headSha: H1,
        head: "agent/wf",
        base: "main",
        draft: true,
        merged: false,
        htmlUrl: "https://github.com/i-kohan/ai-native-learning/pull/7",
      };
      pulls = [pull];
      return pull;
    },
    getPull: async (number) =>
      pulls.find((item) => item.number === number) ?? pulls[0],
    createIssue: async () => ({
      number: 11,
      htmlUrl: "https://github.com/i-kohan/ai-native-learning/issues/11",
    }),
    listWorkflowRuns: async () => options?.runs ?? [],
    listJobs: async () => [
      {
        id: 1,
        name: "test",
        conclusion: options?.runs?.[0]?.conclusion ?? "success",
        steps: [
          {
            name: "npm test",
            conclusion: options?.runs?.[0]?.conclusion ?? "success",
          },
        ],
      },
    ],
    getJobLogExcerpt: async () => options?.jobLog ?? "ok",
  };
  return client;
}

describe("delivery branch identity", () => {
  it("rejects the default/protected branch target", () => {
    assert.throws(
      () => assertSafeDeliveryBranch("main", "main"),
      (error: unknown) =>
        error instanceof DeliveryError && error.code === "protected_branch",
    );
    assert.throws(
      () => assertSafeDeliveryBranch("master", "trunk"),
      (error: unknown) =>
        error instanceof DeliveryError && error.code === "protected_branch",
    );
    assert.equal(deliveryBranchFor("wf 20"), "agent/wf-20");
    assertSafeDeliveryBranch("agent/wf-20", "main");
  });

  it("has no force-push path", () => {
    assert.deepEqual(gitPushArgs("agent/wf"), [
      "push",
      "origin",
      "HEAD:refs/heads/agent/wf",
    ]);
    assert.deepEqual(gitRefUpdateBody(H1), { sha: H1, force: false });
    assert.throws(() => assertNoForcePush(["push", "--force", "origin"]));
    assert.throws(() => assertNoForcePush(["push", "-f", "origin"]));
  });
});

describe("branch and PR reconciliation", () => {
  it("creates when remote is absent and treats equal remote as already done", () => {
    assert.deepEqual(
      decideRemoteBranchAction({ remoteSha: null, intendedSha: H1 }),
      { action: "create", sha: H1 },
    );
    assert.deepEqual(
      decideRemoteBranchAction({
        remoteSha: H1,
        intendedSha: H1,
        previousSha: BASE,
      }),
      { action: "already_equal", sha: H1 },
    );
    assert.deepEqual(
      decideRemoteBranchAction({
        remoteSha: H1,
        intendedSha: H2,
        previousSha: H1,
      }),
      { action: "update", sha: H2, from: H1 },
    );
  });

  it("fails closed on unexpected remote branch movement", () => {
    assert.throws(
      () =>
        decideRemoteBranchAction({
          remoteSha: OTHER,
          intendedSha: H2,
          previousSha: H1,
        }),
      (error: unknown) =>
        error instanceof DeliveryError &&
        error.code === "unexpected_remote_head",
    );
  });

  it("reuses an existing PR after restart and after an ambiguous create", async () => {
    const existing: GitHubPull = {
      number: 7,
      headSha: H1,
      head: "agent/wf-reuse",
      base: "main",
      draft: true,
      merged: false,
      htmlUrl: "https://example.com/7",
    };
    const reuse = mockGithub({ pulls: [existing] });
    const state = {
      ...createLocalAcceptedDelivery({
        workflowId: "wf-reuse",
        repository: "i-kohan/ai-native-learning",
        issueNumber: 11,
        issueUrl: "https://example.com/11",
        defaultBranch: "main",
        baseSha: BASE,
        spec: GHI01_SPEC,
        reviewBaseline: { artifactId: "a", fingerprint: "f" },
        workspace: dummyWorkspace("/tmp", "wf-reuse"),
        task: "task",
      }),
      deliveryPhase: "branch_reconciled" as const,
      expectedHeadSha: H1,
      publishedHeadSha: H1,
    };
    const first = await reconcileDraftPull({
      github: reuse,
      state,
      title: "t",
      body: "b",
    });
    assert.equal(first.number, 7);
    assert.equal(reuse.createPullCalls, 0);

    let listedAfterError = false;
    const ambiguous = mockGithub({
      createPull: async () => {
        throw new DeliveryError(
          "ambiguous_side_effect",
          "create may have happened",
          {
            operation: "create_pull",
          },
        );
      },
    });
    const originalList = ambiguous.listPulls;
    let listCalls = 0;
    ambiguous.listPulls = async (args) => {
      listCalls += 1;
      if (listCalls === 1) {
        return [];
      }
      listedAfterError = true;
      return [existing];
    };
    const reconciled = await reconcileDraftPull({
      github: ambiguous,
      state,
      title: "t",
      body: "b",
    });
    assert.equal(reconciled.number, 7);
    assert.equal(listedAfterError, true);
    assert.equal(ambiguous.createPullCalls, 1);
    void originalList;
  });
});

describe("current-head CI admission", () => {
  it("rejects CI PASS for a stale SHA", () => {
    const storeDir = tmpDir("del-stale-");
    const workflowId = "wf-stale";
    let state = seedDelivery(storeDir, workflowId);
    state = admitHeadCommitted({ current: state, expectedHeadSha: H2 });
    saveDeliveryStateUnfenced(storeDir, state);
    state = { ...state, deliveryPhase: "ci_waiting", prNumber: 7 };
    const stale = observation({
      headSha: H1,
      conclusion: "success",
      failureClass: "success",
    });
    assert.deepEqual(admitCurrentHeadCi({ state, observation: stale }), {
      action: "ignore_stale",
    });
    assert.equal(
      classifyCiEvidence({
        expectedHeadSha: H2,
        headSha: H1,
        conclusion: "success",
        evidenceExcerpt: "ok",
      }),
      "stale",
    );
    assert.throws(
      () => admitReadyForHumanReview({ current: state, observation: stale }),
      (error: unknown) =>
        error instanceof DeliveryError && error.code === "stale_ci_evidence",
    );
  });

  it("sends semantic CI failure to repair and infrastructure to reobserve", () => {
    const storeDir = tmpDir("del-class-");
    let state = seedDelivery(storeDir, "wf-class");
    state = admitHeadCommitted({ current: state, expectedHeadSha: H1 });
    state = { ...state, deliveryPhase: "ci_waiting", prNumber: 7 };
    assert.deepEqual(
      admitCurrentHeadCi({
        state,
        observation: observation({
          conclusion: "failure",
          failureClass: "semantic",
          evidenceExcerpt: "CI01_CONTROLLED_RED",
        }),
      }),
      { action: "repair" },
    );
    assert.deepEqual(
      admitCurrentHeadCi({
        state,
        observation: observation({
          conclusion: "startup_failure",
          failureClass: "infrastructure",
        }),
      }),
      { action: "reobserve" },
    );
  });
});

describe("delivery runner contracts", () => {
  it("reuses the same PR on ci_waiting restart", async () => {
    const storeDir = tmpDir("del-wait-");
    const workflowId = "wf-wait";
    let state = seedDelivery(storeDir, workflowId);
    state = admitHeadCommitted({ current: state, expectedHeadSha: H1 });
    state = {
      ...state,
      deliveryPhase: "ci_waiting",
      prNumber: 7,
      publishedHeadSha: H1,
    };
    saveDeliveryStateUnfenced(storeDir, state);
    const github = mockGithub({
      remote: { sha: H1 },
      pulls: [
        {
          number: 7,
          headSha: H1,
          head: `agent/${workflowId}`,
          base: "main",
          draft: true,
          merged: false,
          htmlUrl: "https://example.com/7",
        },
      ],
      runs: [
        {
          id: 99,
          name: "CI",
          status: "completed",
          conclusion: "success",
          headSha: H1,
        },
      ],
    });
    const result = await runDelivery({
      config: dummyConfig(state.workspace.root),
      storeDir,
      workflowId,
      hostRepoRoot: storeDir,
      github,
      repository: "i-kohan/ai-native-learning",
      issueNumber: 11,
      issueUrl: "https://example.com/11",
      defaultBranch: "main",
      spec: GHI01_SPEC,
      reviewBaseline: state.reviewBaseline,
      runId: "restart-ci",
      git: mockGit([H1]),
      verify: () => ({ passed: true, exitCode: 0, output: "", durationMs: 1 }),
      review: async () => ({ status: "pass", findings: [] }),
      nowMs: () => 1_000,
      sleep: async () => undefined,
      ciPollTimeoutMs: 1,
      ciPollIntervalMs: 0,
    });
    assert.equal(result.delivery.prNumber, 7);
    assert.equal(result.outcome, "ready_for_human_review");
    assert.equal(github.createPullCalls, 0);
  });

  it("does not mutate the artifact on infrastructure CI failure", async () => {
    const storeDir = tmpDir("del-infra-");
    const workflowId = "wf-infra";
    let state = seedDelivery(storeDir, workflowId);
    state = admitHeadCommitted({ current: state, expectedHeadSha: H1 });
    state = {
      ...state,
      deliveryPhase: "ci_waiting",
      prNumber: 7,
      publishedHeadSha: H1,
    };
    saveDeliveryStateUnfenced(storeDir, state);
    let repaired = false;
    const github = mockGithub({
      remote: { sha: H1 },
      runs: [
        {
          id: 1,
          name: "CI",
          status: "completed",
          conclusion: "startup_failure",
          headSha: H1,
        },
      ],
      jobLog: "runner setup failed",
    });
    const result = await runDelivery({
      config: dummyConfig(state.workspace.root),
      storeDir,
      workflowId,
      hostRepoRoot: storeDir,
      github,
      repository: "i-kohan/ai-native-learning",
      issueNumber: 11,
      issueUrl: "https://example.com/11",
      defaultBranch: "main",
      spec: GHI01_SPEC,
      reviewBaseline: state.reviewBaseline,
      runId: "infra",
      git: mockGit([H2]),
      verify: () => ({ passed: true, exitCode: 0, output: "", durationMs: 1 }),
      review: async () => ({ status: "pass", findings: [] }),
      repair: async () => {
        repaired = true;
      },
      nowMs: (() => {
        let n = 0;
        return () => {
          n += 1;
          return n * 1_000;
        };
      })(),
      sleep: async () => undefined,
      ciPollTimeoutMs: 1_500,
      ciPollIntervalMs: 0,
    });
    assert.equal(repaired, false);
    assert.equal(result.delivery.expectedHeadSha, H1);
    assert.notEqual(result.outcome, "ready_for_human_review");
  });

  it("takes the repair path for semantic CI failure and requires a new SHA", async () => {
    const storeDir = tmpDir("del-repair-");
    const workflowId = "wf-repair";
    let state = seedDelivery(storeDir, workflowId);
    state = admitHeadCommitted({ current: state, expectedHeadSha: H1 });
    state = {
      ...state,
      deliveryPhase: "ci_waiting",
      prNumber: 7,
      publishedHeadSha: H1,
    };
    saveDeliveryStateUnfenced(storeDir, state);
    let repaired = false;
    let verifyCount = 0;
    let reviewCount = 0;
    const github = mockGithub({
      remote: { sha: H1 },
      runs: [
        {
          id: 1,
          name: "CI",
          status: "completed",
          conclusion: "failure",
          headSha: H1,
        },
      ],
      jobLog: "CI01_CONTROLLED_RED",
    });
    github.listWorkflowRuns = async (sha) => {
      if (sha === H2) {
        return [
          {
            id: 2,
            name: "CI",
            status: "completed",
            conclusion: "success",
            headSha: H2,
          },
        ];
      }
      return [
        {
          id: 1,
          name: "CI",
          status: "completed",
          conclusion: "failure",
          headSha: H1,
        },
      ];
    };
    github.getRef = async () => ({ sha: githubHead() });
    let published = H1;
    const githubHead = () => published;
    const result = await runDelivery({
      config: dummyConfig(state.workspace.root),
      storeDir,
      workflowId,
      hostRepoRoot: storeDir,
      github,
      repository: "i-kohan/ai-native-learning",
      issueNumber: 11,
      issueUrl: "https://example.com/11",
      defaultBranch: "main",
      spec: GHI01_SPEC,
      reviewBaseline: state.reviewBaseline,
      runId: "repair",
      git: {
        revParse: () => published,
        commitAcceptedTree: () => {
          published = H2;
          return H2;
        },
        pushBranch: () => {
          published = H2;
        },
      },
      verify: () => {
        verifyCount += 1;
        return { passed: true, exitCode: 0, output: "", durationMs: 1 };
      },
      review: async () => {
        reviewCount += 1;
        return { status: "pass", findings: [] };
      },
      repair: async () => {
        repaired = true;
      },
      nowMs: () => 1_000,
      sleep: async () => undefined,
      ciPollTimeoutMs: 5_000,
      ciPollIntervalMs: 0,
    });
    assert.equal(repaired, true);
    assert.equal(result.delivery.firstHeadSha, H1);
    assert.equal(result.delivery.expectedHeadSha, H2);
    assert.notEqual(
      result.delivery.firstHeadSha,
      result.delivery.expectedHeadSha,
    );
    assert.ok(verifyCount >= 1);
    assert.ok(reviewCount >= 1);
    assert.equal(result.outcome, "ready_for_human_review");
    assert.equal(result.delivery.prNumber, 7);
  });

  it("does not set expectedHeadSha to H2 when fresh REVIEW fails", async () => {
    const storeDir = tmpDir("del-fresh-");
    const workflowId = "wf-fresh";
    let state = seedDelivery(storeDir, workflowId);
    state = admitHeadCommitted({ current: state, expectedHeadSha: H1 });
    state = {
      ...state,
      deliveryPhase: "ci_waiting",
      prNumber: 7,
      publishedHeadSha: H1,
    };
    saveDeliveryStateUnfenced(storeDir, state);
    const github = mockGithub({
      remote: { sha: H1 },
      runs: [
        {
          id: 1,
          name: "CI",
          status: "completed",
          conclusion: "failure",
          headSha: H1,
        },
      ],
      jobLog: "CI01_CONTROLLED_RED",
    });
    const result = await runDelivery({
      config: dummyConfig(state.workspace.root),
      storeDir,
      workflowId,
      hostRepoRoot: storeDir,
      github,
      repository: "i-kohan/ai-native-learning",
      issueNumber: 11,
      issueUrl: "https://example.com/11",
      defaultBranch: "main",
      spec: GHI01_SPEC,
      reviewBaseline: state.reviewBaseline,
      runId: "fresh-review",
      git: mockGit([H2]),
      verify: () => ({ passed: true, exitCode: 0, output: "", durationMs: 1 }),
      review: async () => ({
        status: "findings",
        findings: [],
      }),
      repair: async () => undefined,
      nowMs: () => 1_000,
      sleep: async () => undefined,
      ciPollTimeoutMs: 1_000,
      ciPollIntervalMs: 0,
    });
    const loaded = loadDeliveryState(storeDir, workflowId);
    assert.equal(loaded.expectedHeadSha, H1);
    assert.equal(result.delivery.expectedHeadSha, H1);
    assert.equal(result.outcome, "delivery_failed");
  });
});

describe("delivery credential isolation", () => {
  it("does not inherit GitHub credentials into repository test env", () => {
    const parent = {
      PATH: "/usr/bin",
      GITHUB_TOKEN: "ghp_should-not-leak-into-tests",
      GH_TOKEN: "gho_also-hidden",
      OPENAI_API_KEY: "sk-hidden",
    };
    const child = verificationChildEnv(parent);
    const gitEnv = deliveryGitEnv(parent);
    assert.equal(child.GITHUB_TOKEN, undefined);
    assert.equal(child.GH_TOKEN, undefined);
    assert.equal(gitEnv.GITHUB_TOKEN, undefined);
    assert.equal(gitEnv.GH_TOKEN, undefined);
    assert.equal(
      redactSecrets("token ghp_should-not-leak-into-tests in log", [
        "ghp_should-not-leak-into-tests",
      ]),
      "token [redacted] in log",
    );
  });
});

describe("acceptDeliveryCandidate", () => {
  it("refuses to accept when VERIFY fails", async () => {
    const root = tmpDir("del-acc-");
    fs.mkdirSync(path.join(root, "target-app", "src"), { recursive: true });
    const tracer = new Tracer(path.join(root, "traces"), "acc");
    await assert.rejects(
      () =>
        acceptDeliveryCandidate({
          config: dummyConfig(root),
          spec: GHI01_SPEC,
          baseline: snapshotDirectory(path.join(root, "target-app", "src")),
          tracer,
          verify: () => ({
            passed: false,
            exitCode: 1,
            output: "fail",
            durationMs: 1,
          }),
          review: async () => ({ status: "pass", findings: [] }),
        }),
      (error: unknown) =>
        error instanceof DeliveryError && error.code === "delivery_failed",
    );
    await tracer.close();
  });
});
