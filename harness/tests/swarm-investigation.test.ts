import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT, type HarnessConfig } from "../src/config.ts";
import { workerToolsForEpisode } from "../src/evidence.ts";
import {
  executeInvestigationTool,
  type InvestigationResponsesCreate,
} from "../src/investigation-episode.ts";
import {
  admitChildInvestigationReport,
  lostChildFindings,
} from "../src/investigation-report.ts";
import {
  buildSynthesisInput,
  buildWorkerHandoff,
  evaluateSwm01LiveMechanism,
  runBaselineInvestigation,
  runMultiAgentInvestigation,
  synthesisInvestigationTools,
  workerInvestigationTools,
  type ChildExecutionRecord,
} from "../src/investigation-swarm.ts";
import { gradeInvestigationReport } from "../src/swm01-grader.ts";
import { SWM01_SURFACES } from "../src/swm01-contract.ts";
import { admitSwarmPlan } from "../src/swarm-plan.ts";
import type { InvestigationReport } from "../src/investigation-report.ts";

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swm01-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs/note.txt"),
    "UNIQUE_FILE_BODY harness note\n",
    "utf8",
  );
  return {
    apiKey: "test",
    model: "test-model",
    maxTurns: 20,
    maxRepairAttempts: 1,
    maxReviewRepairAttempts: 1,
    repoRoot: root,
    targetAppRoot: path.join(root, "target-app"),
    targetSrcRoot: path.join(root, "target-app", "src"),
    tracesDir: path.join(root, "traces"),
  };
}

function workers(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `w${index + 1}`,
    objective: `slice ${index + 1}`,
    scopeHint: "",
  }));
}

function functionResponse(callId: string, name: string, args: unknown) {
  return {
    id: `resp_${callId}`,
    output: [
      {
        type: "function_call",
        call_id: callId,
        name,
        arguments: JSON.stringify(args),
      },
    ],
    usage: { input_tokens: 11, output_tokens: 7 },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SWM01 swarm admission", () => {
  it("rejects more than three workers", () => {
    const admitted = admitSwarmPlan({ workers: workers(4) });
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.match(admitted.error, /2 to 3 workers/);
    }
  });

  it("rejects one worker, an empty objective, and duplicate ids", () => {
    const one = admitSwarmPlan({ workers: workers(1) });
    assert.equal(one.ok, false);

    const empty = admitSwarmPlan({
      workers: [
        { id: "a", objective: "   " },
        { id: "b", objective: "slice b" },
      ],
    });
    assert.equal(empty.ok, false);
    if (!empty.ok) {
      assert.match(empty.error, /objective/);
    }

    const duplicate = admitSwarmPlan({
      workers: [
        { id: "a", objective: "one" },
        { id: "a", objective: "two" },
      ],
    });
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) {
      assert.match(duplicate.error, /unique/);
    }
  });

  it("rejects model-controlled authority fields", () => {
    const admitted = admitSwarmPlan({
      workers: workers(2),
      model: "gpt-elsewhere",
      maxRounds: 1,
    });
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.match(admitted.error, /authority/);
    }
  });

  it("does not execute workers when the plan is over budget", async () => {
    let calls = 0;
    const result = await runMultiAgentInvestigation({
      config: tempConfig(),
      objective: "PARENT_OBJECTIVE_MARKER",
      proposedPlan: { workers: workers(4) },
      responsesCreate: async () => {
        calls += 1;
        throw new Error("workers must not start");
      },
    });
    assert.equal(result.admission.ok, false);
    assert.equal(result.children.length, 0);
    assert.equal(result.report, null);
    assert.equal(calls, 0);
  });
});

describe("SWM01 worker capability boundary", () => {
  it("advertises only list_files, read_file, and submit_investigation_report", () => {
    assert.deepEqual(
      workerInvestigationTools().map((tool) => tool.name),
      ["list_files", "read_file", "submit_investigation_report"],
    );
    assert.deepEqual(
      synthesisInvestigationTools().map((tool) => tool.name),
      ["submit_investigation_report"],
    );
    const config = tempConfig();
    for (const name of [
      "write_file",
      "delegate_research",
      "run_command",
      "spawn_worker",
    ]) {
      const result = executeInvestigationTool({
        repoRoot: config.repoRoot,
        name,
        argsJson: "{}",
        observedReads: [],
        pathsRead: [],
      });
      assert.equal(result.ok, false);
      assert.match(result.output, /not available/);
    }
  });

  it("does not add swarm tools to the default implementation worker", () => {
    const names = workerToolsForEpisode({
      phase: "implementation",
      subagentsEnabled: false,
    }).map((tool) => tool.name);
    assert.deepEqual(names, [
      "list_files",
      "read_file",
      "write_file",
      "run_command",
    ]);
    const runSource = fs.readFileSync(
      new URL("../src/run.ts", import.meta.url),
      "utf8",
    );
    assert.equal(runSource.includes("SwarmPlan"), false);
    assert.equal(runSource.includes("swm01"), false);
    assert.equal(runSource.includes("runMultiAgentInvestigation"), false);
  });

  it("rejects a child citation for a file the worker did not read", () => {
    const admitted = admitChildInvestigationReport({
      value: {
        findings: [{ claim: "unseen", evidencePaths: ["docs/note.txt"] }],
        uncertainties: [],
      },
      objective: "slice",
      observedReadPaths: [],
    });
    assert.equal(admitted.ok, false);
    if (!admitted.ok) {
      assert.match(admitted.error, /not read/);
    }
  });
});

describe("SWM01 partial child failure", () => {
  it("keeps the failed child visible and does not respawn it", async () => {
    const requests: Array<{
      instructions: string;
      input: unknown;
      tools: Array<{ name: string }>;
    }> = [];
    const callsByWorker = new Map<string, number>();
    const create: InvestigationResponsesCreate = async (request) => {
      requests.push({
        instructions: request.instructions,
        input: request.input,
        tools: request.tools as Array<{ name: string }>,
      });
      if (request.instructions.includes("synthesizing")) {
        return functionResponse("syn", "submit_investigation_report", {
          mechanisms: [],
          uncertainties: [],
          coverageSummary: "full coverage of every mechanism",
        });
      }
      const blob = JSON.stringify(request.input);
      const workerId =
        blob.match(/Worker id: ([A-Za-z0-9_-]+)/)?.[1] ?? "unknown";
      const count = (callsByWorker.get(workerId) ?? 0) + 1;
      callsByWorker.set(workerId, count);
      await delay(40);
      if (count === 1) {
        return functionResponse(`read-${workerId}-${count}`, "read_file", {
          path: "docs/note.txt",
        });
      }
      return functionResponse(
        `child-${workerId}-${count}`,
        "submit_investigation_report",
        {
          findings: [
            { claim: `claim ${workerId}`, evidencePaths: ["docs/note.txt"] },
          ],
          uncertainties: [],
        },
      );
    };

    const result = await runMultiAgentInvestigation({
      config: tempConfig(),
      objective: "PARENT_OBJECTIVE_MARKER",
      proposedPlan: {
        workers: [
          { id: "a", objective: "slice A" },
          { id: "b", objective: "slice B" },
          { id: "c", objective: "slice C" },
        ],
      },
      failWorkerIds: ["b"],
      responsesCreate: create,
    });

    const failed = result.children.find((child) => child.id === "b");
    assert.ok(failed);
    assert.equal(failed?.status, "failure");
    assert.equal(failed?.failureReason, "injected_failure");
    assert.equal(failed?.modelCalls, 0);
    assert.equal(result.children.filter((child) => child.id === "b").length, 1);
    assert.equal(
      requests.some((request) =>
        JSON.stringify(request.input).includes("Worker id: b"),
      ),
      false,
    );
    assert.match(result.synthesisInput ?? "", /Worker b/);
    assert.match(result.synthesisInput ?? "", /injected_failure/);
    assert.equal(
      (result.synthesisInput ?? "").includes("function_call"),
      false,
    );
    assert.equal(
      (result.synthesisInput ?? "").includes("UNIQUE_FILE_BODY"),
      false,
    );
    assert.equal(
      (result.synthesisInput ?? "").includes("PARENT_OBJECTIVE_MARKER"),
      true,
    );
    assert.match(result.report?.coverageSummary ?? "", /Incomplete coverage/);
    assert.equal(
      result.report?.uncertainties.some((item) =>
        item.claim.includes("worker b"),
      ),
      true,
    );
    assert.equal(result.overlap?.overlapped, true);
    assert.equal(
      result.overlap?.pairwise.some(
        (pair) => pair.a === "a" && pair.b === "c" && pair.overlapMs > 0,
      ),
      true,
    );

    const workerRequests = requests.filter((request) =>
      request.instructions.includes("fresh context"),
    );
    assert.equal(workerRequests.length > 0, true);
    for (const request of workerRequests) {
      assert.deepEqual(
        request.tools.map((tool) => tool.name),
        ["list_files", "read_file", "submit_investigation_report"],
      );
      const blob = JSON.stringify(request.input);
      assert.equal(blob.includes("PARENT_OBJECTIVE_MARKER"), false);
      assert.equal(blob.includes("slice A") && blob.includes("slice C"), false);
    }
    const synthesis = requests.find((request) =>
      request.instructions.includes("synthesizing"),
    );
    assert.deepEqual(
      synthesis?.tools.map((tool) => tool.name),
      ["submit_investigation_report"],
    );
    const childA = result.children.find((child) => child.id === "a");
    assert.equal(childA?.report?.objective, "slice A");
    assert.deepEqual(childA?.observedReadPaths, ["docs/note.txt"]);
    const checks = evaluateSwm01LiveMechanism(result);
    assert.equal(checks.workersReadOnly, true);
    assert.equal(checks.workersCannotDelegate, true);
    assert.equal(checks.executionOverlapped, true);
    assert.equal(checks.synthesisReceivesCompressedReports, true);
    assert.equal(checks.leadProducedFinalReport, true);
  });
});

describe("SWM01 grader", () => {
  it("scores a frozen-contract report and flags wrong or missing claims", () => {
    const report = perfectReport();
    const grade = gradeInvestigationReport(report, REPO_ROOT);
    assert.equal(grade.coverageMissing.length, 0);
    assert.equal(grade.coverageRatio, 1);
    assert.deepEqual(grade.incorrectClaims, []);
    assert.equal(grade.correctnessRatio, 1);

    const wrong = perfectReport();
    wrong.mechanisms[0] = {
      ...wrong.mechanisms[0],
      durableSupport: "supported",
    };
    const wrongGrade = gradeInvestigationReport(wrong, REPO_ROOT);
    assert.equal(
      wrongGrade.incorrectClaims.some(
        (item) => item.claim === "durableSupport=supported",
      ),
      true,
    );

    const missing = {
      ...perfectReport(),
      mechanisms: perfectReport().mechanisms.filter(
        (item) => !/a2a/i.test(item.name),
      ),
    };
    const missingGrade = gradeInvestigationReport(missing, REPO_ROOT);
    assert.equal(missingGrade.coverageMissing.includes("a2a_delegation"), true);
    assert.equal(missingGrade.coverageRatio < 1, true);

    const unsupported = perfectReport();
    unsupported.mechanisms[0] = {
      ...unsupported.mechanisms[0],
      evidencePaths: ["harness/src/does-not-exist.ts"],
    };
    const unsupportedGrade = gradeInvestigationReport(unsupported, REPO_ROOT);
    assert.equal(unsupportedGrade.unsupportedFindings.length > 0, true);

    const swarmDefault: InvestigationReport = {
      mechanisms: [
        {
          name: "SWM01 swarm",
          entryPoints: ["harness/src/investigation-swarm.ts"],
          activationOwner: "not the default caller path",
          capabilities: ["read-only workers"],
          evidence: ["probe"],
          retainedOuterAuthority: [
            "the harness keeps the default one-worker path",
          ],
          durableSupport: "unsupported",
          defaultStatus: "default",
          evidencePaths: ["harness/src/investigation-swarm.ts"],
        },
      ],
      uncertainties: [{ claim: "partial", reason: "fixture" }],
      coverageSummary: "fixture",
    };
    const swarmGrade = gradeInvestigationReport(swarmDefault, REPO_ROOT);
    assert.equal(
      swarmGrade.incorrectClaims.some(
        (item) => item.claim === "defaultStatus=default",
      ),
      true,
    );
    assert.equal(SWM01_SURFACES.length, 9);
  });
});

describe("SWM01 baseline schema", () => {
  it("returns one InvestigationReport from a single read-only investigator", async () => {
    let reads = 0;
    const create: InvestigationResponsesCreate = async (request) => {
      assert.equal(request.model, "test-model");
      const names = (request.tools as Array<{ name: string }>).map(
        (tool) => tool.name,
      );
      assert.equal(names.includes("delegate_research"), false);
      assert.equal(names.includes("write_file"), false);
      reads += 1;
      if (reads === 1) {
        return functionResponse("read", "read_file", { path: "docs/note.txt" });
      }
      return functionResponse("final", "submit_investigation_report", {
        mechanisms: [
          {
            name: "note",
            entryPoints: ["docs/note.txt"],
            activationOwner: "harness",
            capabilities: ["read"],
            evidence: ["note"],
            retainedOuterAuthority: ["harness"],
            durableSupport: "unknown",
            defaultStatus: "opt-in",
            evidencePaths: ["docs/note.txt"],
          },
        ],
        uncertainties: [{ claim: "fixture", reason: "test" }],
        coverageSummary: "fixture coverage",
      });
    };
    const result = await runBaselineInvestigation({
      config: tempConfig(),
      objective: "PARENT_OBJECTIVE_MARKER",
      responsesCreate: create,
    });
    assert.equal(result.ok, true);
    assert.equal(result.model, "test-model");
    assert.equal(result.report?.mechanisms.length, 1);
    assert.deepEqual(result.observedReadPaths, ["docs/note.txt"]);
  });
});

describe("SWM01 handoff", () => {
  it("builds a worker handoff without sibling findings", () => {
    const handoff = buildWorkerHandoff({ id: "a", objective: "slice A" });
    assert.match(handoff, /slice A/);
    assert.equal(handoff.includes("slice B"), false);
    const child: ChildExecutionRecord = {
      id: "b",
      objective: "slice B",
      scopeHint: null,
      status: "failure",
      failureReason: "injected_failure",
      report: null,
      observedReadPaths: [],
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      modelCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      pathsRead: [],
      reportBytes: 0,
    };
    const input = buildSynthesisInput({
      objective: "audit",
      children: [child],
    });
    assert.match(input, /injected_failure/);
    assert.equal(input.includes("function_call"), false);
    const lost = lostChildFindings(
      [
        {
          id: "a",
          report: {
            objective: "slice A",
            findings: [
              { claim: "kept out", evidencePaths: ["docs/other.txt"] },
            ],
            uncertainties: [],
          },
        },
      ],
      {
        mechanisms: [],
        uncertainties: [],
        coverageSummary: "none",
      },
    );
    assert.equal(lost.length, 1);
    assert.equal(lost[0]?.workerId, "a");
  });
});

function perfectReport(): InvestigationReport {
  return {
    mechanisms: [
      surface(
        "Explicit Planner",
        "unsupported",
        "opt-in",
        "harness/src/planner-phase.ts",
        "read-only submit_plan",
        "The harness runs it only when the caller sets planningEnabled",
      ),
      surface(
        "Research Subagent",
        "unsupported",
        "opt-in",
        "harness/src/research-subagent.ts",
        "delegate_research returns evidence",
        "The caller sets the flag and the harness admits the child",
      ),
      surface(
        "ReviewPlan human-reviewable decomposition",
        "unsupported",
        "conditional",
        "harness/src/review-plan.ts",
        "advisory sequential unit scope",
        "The caller supplies a binder and the harness admits it",
      ),
      surface(
        "Bounded fan-out",
        "unsupported",
        "opt-in",
        "harness/src/fan-out.ts",
        "isolated worktree implementation and fan-in",
        "The caller supplies a binder and the harness admits it",
      ),
      surface(
        "MCP repository read",
        "unsupported",
        "opt-in",
        "harness/src/mcp/repo-read-host.ts",
        "MCP repo_read_file",
        "The caller sets the flag and the host admits it",
      ),
      surface(
        "Verified repository memory",
        "unsupported",
        "opt-in",
        "harness/src/memory.ts",
        "advisory memory hint",
        "The caller sets memory and the harness admits it",
      ),
      surface(
        "A2A delegation",
        "unsupported",
        "opt-in",
        "harness/src/a2a/host.ts",
        "remote delegate artifact",
        "The caller sets the flag and the host admits it",
      ),
      surface(
        "Durable execution",
        "partial",
        "opt-in",
        "harness/src/workflow-state.ts",
        "WorkflowState checkpoints and fencing",
        "The caller opts into durable execution and the harness owns it",
      ),
      surface(
        "GitHub CI delivery",
        "partial",
        "opt-in",
        "harness/src/delivery-run.ts",
        "draft PR and CI admission",
        "Post-terminal delivery is owned by the harness",
      ),
    ],
    uncertainties: [{ claim: "coverage is bounded", reason: "fixture" }],
    coverageSummary: "fixture covers the frozen surfaces",
  };
}

function surface(
  name: string,
  durableSupport: InvestigationReport["mechanisms"][number]["durableSupport"],
  defaultStatus: InvestigationReport["mechanisms"][number]["defaultStatus"],
  evidencePath: string,
  capability: string,
  activationOwner: string,
): InvestigationReport["mechanisms"][number] {
  return {
    name,
    entryPoints: [evidencePath],
    activationOwner,
    capabilities: [capability],
    evidence: ["repository file"],
    retainedOuterAuthority: ["VERIFY and REVIEW stay with the harness"],
    durableSupport,
    defaultStatus,
    evidencePaths: [evidencePath],
  };
}
