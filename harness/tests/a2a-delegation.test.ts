import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { Express } from "express";
import { describe, it } from "node:test";
import { TaskState, type AgentCard } from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { admitDiscoveredAgent } from "../src/a2a/admission.ts";
import { admitImpactArtifact } from "../src/a2a/artifact.ts";
import { buildImpactAgentCard } from "../src/a2a/impact-card.ts";
import { createImpactApp } from "../src/a2a/impact-server.ts";
import { runImpactAnalysisEpisode } from "../src/a2a/impact-executor.ts";
import {
  remoteProcessEnv,
  startImpactAgentProcess,
} from "../src/a2a/delegation.ts";
import {
  buildImpactSendRequest,
  performRemoteImpactDelegation,
} from "../src/a2a/host.ts";
import type { HarnessConfig } from "../src/config.ts";
import {
  runAgentLoop,
  type ResponsesCreateFn,
  type ResponsesCreateRequest,
} from "../src/loop.ts";
import { runV1Harness } from "../src/run.ts";
import { WorkflowError } from "../src/workflow-error.ts";

describe("A2A host admission", () => {
  it("rejects a card without repository-impact-analysis before SendMessage", async () => {
    const root = tempRepo();
    const executor = new ScriptedExecutor({
      objective: "impact",
      relevantPaths: ["src/app.ts"],
      findings: [{ path: "src/app.ts", observation: "used" }],
    });
    const started = await startApp(
      root,
      (baseUrl) => {
        const card = buildImpactAgentCard(baseUrl);
        card.skills = [];
        return card;
      },
      executor,
    );
    try {
      const result = await performRemoteImpactDelegation({
        workflowId: "parent-workflow",
        baseUrl: started.baseUrl,
        allowedRoot: root,
        objective: "Where is the missing-task error?",
        scope: "src",
      });
      assert.equal(result.record.cardDiscovered, true);
      assert.equal(result.record.admission, "fail");
      assert.equal(result.record.admissionReason, "skill_not_advertised");
      assert.equal(result.record.sendMessagePerformed, false);
      assert.equal(result.record.outcome, "admission_rejected");
      assert.equal(result.record.grantsWorkflowSuccess, false);
      assert.equal(executor.calls, 0);
      assert.equal(result.ok, false);
    } finally {
      await started.close();
    }
  });

  it("rejects an incompatible protocol version without calling the client", () => {
    const card = buildImpactAgentCard("http://127.0.0.1:9");
    card.supportedInterfaces = [
      {
        ...card.supportedInterfaces[0],
        url: "http://127.0.0.1:9/a2a/rest",
        protocolVersion: "0.3",
      },
    ];
    const admission = admitDiscoveredAgent(card, {
      interfaceUrl: "http://127.0.0.1:9/a2a/rest",
    });
    assert.equal(admission.ok, false);
    if (!admission.ok) {
      assert.equal(admission.reason, "interface_not_admitted");
    }
  });
});

describe("A2A artifact admission", () => {
  it("rejects a path outside the delegated scope and does not emit advisory evidence", async () => {
    const root = tempRepo();
    const executor = new ScriptedExecutor({
      objective: "impact",
      relevantPaths: ["../../secret.txt"],
      findings: [
        { path: "../../secret.txt", observation: "secret-observation" },
      ],
    });
    const started = await startApp(
      root,
      (baseUrl) => buildImpactAgentCard(baseUrl),
      executor,
    );
    try {
      const result = await performRemoteImpactDelegation({
        workflowId: "parent-workflow",
        baseUrl: started.baseUrl,
        allowedRoot: root,
        objective: "Where is the missing-task error?",
        scope: "src",
      });
      assert.equal(executor.calls, 1);
      assert.equal(result.record.sendMessagePerformed, true);
      assert.equal(result.record.taskTerminalState, "TASK_STATE_COMPLETED");
      assert.equal(result.record.artifactAdmission, "rejected");
      assert.equal(result.record.outcome, "artifact_rejected");
      assert.equal(result.ok, false);
      assert.equal(result.artifact, null);
      assert.equal(result.output.includes("secret-observation"), false);
      assert.equal(result.output.includes("advisory evidence only"), false);
      assert.equal(result.record.grantsWorkflowSuccess, false);
    } finally {
      await started.close();
    }
  });

  it("rejects traversal in the structured artifact helper", () => {
    const root = tempRepo();
    const admitted = admitImpactArtifact(
      {
        objective: "impact",
        relevantPaths: ["../../secret.txt"],
        findings: [{ path: "../../secret.txt", observation: "no" }],
      },
      { allowedRoot: root, scope: "src" },
    );
    assert.equal(admitted.ok, false);
  });
});

describe("A2A task identity", () => {
  it("uses a remote task id that is not the parent workflow id", async () => {
    const root = tempRepo();
    const executor = new ScriptedExecutor({
      objective: "impact",
      relevantPaths: ["src/app.ts"],
      findings: [
        { path: "src/app.ts", observation: "missing task returns 500" },
      ],
    });
    const started = await startApp(
      root,
      (baseUrl) => buildImpactAgentCard(baseUrl),
      executor,
    );
    try {
      const workflowId = "parent-workflow";
      const result = await performRemoteImpactDelegation({
        workflowId,
        baseUrl: started.baseUrl,
        allowedRoot: root,
        objective: "Where is the missing-task error?",
        scope: "src",
      });
      assert.equal(result.record.outcome, "accepted");
      assert.equal(result.record.admission, "pass");
      assert.equal(result.record.cardDiscovered, true);
      assert.ok(result.record.taskId);
      assert.notEqual(result.record.taskId, workflowId);
      assert.notEqual(result.record.taskId, result.record.delegationId);
      assert.equal(result.record.taskTerminalState, "TASK_STATE_COMPLETED");
      assert.equal(result.record.artifactAdmission, "accepted");
      assert.equal(result.record.grantsWorkflowSuccess, false);
      assert.equal("workflowStatus" in result.record, false);
      assert.match(result.output, /advisory evidence only/);
      assert.match(result.output, /src\/app\.ts/);
      const request = buildImpactSendRequest({
        objective: "Where is the missing-task error?",
        scope: "src",
      });
      assert.equal(request.message?.taskId, "");
      assert.notEqual(request.message?.taskId, workflowId);
    } finally {
      await started.close();
    }
  });
});

describe("A2A remote boundary", () => {
  it("does not pass the parent API key or arbitrary environment into the child", () => {
    const previousKey = process.env.OPENAI_API_KEY;
    const previousGithub = process.env.GITHUB_TOKEN;
    process.env.OPENAI_API_KEY = "parent-secret";
    process.env.GITHUB_TOKEN = "github-secret";
    try {
      const env = remoteProcessEnv({
        allowedRoot: "/tmp/a2a-root",
        remoteApiKey: "remote-secret",
        model: "test-model",
        port: 9,
        baseUrl: "http://127.0.0.1:9",
      });
      assert.equal(env.OPENAI_API_KEY, undefined);
      assert.equal(env.GITHUB_TOKEN, undefined);
      assert.equal(env.A2A_REMOTE_OPENAI_API_KEY, "remote-secret");
      assert.equal(env.A2A_ALLOWED_ROOT, "/tmp/a2a-root");
      assert.equal(env.A2A_REMOTE_MODEL, "test-model");
    } finally {
      restoreEnv("OPENAI_API_KEY", previousKey);
      restoreEnv("GITHUB_TOKEN", previousGithub);
    }
  });

  it("serves the agent card from a separate process without the parent API key", async () => {
    const root = tempRepo();
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "parent-secret";
    const agent = await startImpactAgentProcess({
      allowedRoot: root,
      remoteApiKey: "remote-secret",
      model: "unused-model",
    });
    try {
      const response = await fetch(
        `${agent.baseUrl}/.well-known/agent-card.json`,
      );
      assert.equal(response.ok, true);
      const card = (await response.json()) as {
        name?: string;
        skills?: Array<{ id?: string }>;
        supportedInterfaces?: Array<{
          protocolBinding?: string;
          protocolVersion?: string;
        }>;
      };
      const admission = admitDiscoveredAgent(card, {
        interfaceUrl: `${agent.baseUrl}/a2a/rest`,
      });
      assert.equal(admission.ok, true);
      assert.equal(card.name, "harness-impact-agent");
      assert.equal(card.skills?.[0]?.id, "repository-impact-analysis");
      assert.equal(card.supportedInterfaces?.[0]?.protocolBinding, "HTTP+JSON");
      assert.equal(card.supportedInterfaces?.[0]?.protocolVersion, "1.0");
      assert.ok(agent.pid > 0);
      assert.notEqual(agent.pid, process.pid);
    } finally {
      await agent.stop();
      restoreEnv("OPENAI_API_KEY", previousKey);
    }
  });

  it("keeps the remote episode on read-only tools and rejects an escaping artifact", async () => {
    const root = tempRepo();
    let step = 0;
    const analysis = await runImpactAnalysisEpisode({
      allowedRoot: root,
      apiKey: "remote-secret",
      model: "test-model",
      objective: "Where is the missing-task error?",
      scope: "src",
      responsesCreate: async (request) => {
        const names = (request.tools as Array<{ name: string }>).map(
          (tool) => tool.name,
        );
        assert.deepEqual(names, [
          "list_files",
          "read_file",
          "submit_impact_analysis",
        ]);
        step += 1;
        if (step === 1) {
          return {
            id: "list",
            output: [
              {
                type: "function_call",
                call_id: "c1",
                name: "list_files",
                arguments: JSON.stringify({ path: "src" }),
              },
            ],
          };
        }
        if (step === 2) {
          return {
            id: "read",
            output: [
              {
                type: "function_call",
                call_id: "c2",
                name: "read_file",
                arguments: JSON.stringify({ path: "src/app.ts" }),
              },
            ],
          };
        }
        return {
          id: "submit",
          output: [
            {
              type: "function_call",
              call_id: "c3",
              name: "submit_impact_analysis",
              arguments: JSON.stringify({
                objective: "Where is the missing-task error?",
                relevantPaths: ["src/app.ts"],
                findings: [
                  {
                    path: "src/app.ts",
                    observation: "the handler returns 500",
                  },
                ],
              }),
            },
          ],
        };
      },
    });
    assert.deepEqual(analysis.relevantPaths, ["src/app.ts"]);
    assert.match(analysis.findings[0]?.observation ?? "", /500/);

    await assert.rejects(() =>
      runImpactAnalysisEpisode({
        allowedRoot: root,
        apiKey: "remote-secret",
        model: "test-model",
        objective: "escape",
        scope: "src",
        responsesCreate: async () => ({
          id: "bad",
          output: [
            {
              type: "function_call",
              call_id: "c",
              name: "submit_impact_analysis",
              arguments: JSON.stringify({
                objective: "escape",
                relevantPaths: ["../../secret.txt"],
                findings: [{ path: "../../secret.txt", observation: "no" }],
              }),
            },
          ],
        }),
      }),
    );
  });
});

describe("A2A worker seam", () => {
  it("leaves the default implementation tool list unchanged", async () => {
    const root = tempRepo();
    const requests: ResponsesCreateRequest[] = [];
    const create: ResponsesCreateFn = async (request) => {
      requests.push(request);
      return {
        id: "resp",
        output: [
          { type: "message", content: [{ type: "output_text", text: "done" }] },
        ],
        output_text: "done",
      } as never;
    };
    await runAgentLoop({
      config: harnessConfig(root),
      task: "fix the bug",
      runId: "a2a-default",
      responsesCreate: create,
    });
    const names = (requests[0]?.tools as Array<{ name: string }>).map(
      (tool) => tool.name,
    );
    assert.equal(names.includes("delegate_remote_analysis"), false);
    assert.equal(
      requests[0]?.instructions.includes("delegate_remote_analysis"),
      false,
    );
  });

  it("offers only objective and scope when the experiment is enabled", async () => {
    const root = tempRepo();
    const requests: ResponsesCreateRequest[] = [];
    const create: ResponsesCreateFn = async (request) => {
      requests.push(request);
      return {
        id: "resp",
        output_text: "done",
        output: [
          { type: "message", content: [{ type: "output_text", text: "done" }] },
        ],
      } as never;
    };
    await runAgentLoop({
      config: harnessConfig(root),
      task: "fix the bug",
      runId: "a2a-enabled",
      responsesCreate: create,
      a2aDelegationEnabled: true,
    });
    const tools = requests[0]?.tools as Array<{
      name: string;
      parameters: { properties: Record<string, unknown>; required: string[] };
    }>;
    const tool = tools.find((item) => item.name === "delegate_remote_analysis");
    assert.ok(tool);
    assert.deepEqual(Object.keys(tool.parameters.properties).sort(), [
      "objective",
      "scope",
    ]);
    assert.deepEqual(tool.parameters.required.sort(), ["objective", "scope"]);
    assert.match(requests[0]?.instructions ?? "", /exactly once/);
  });

  it("rejects durable execution", async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "a2a-durable-"));
    await assert.rejects(
      () =>
        runV1Harness({
          config: harnessConfig(storeDir),
          task: "task",
          runId: "a2a-durable",
          a2aDelegationEnabled: true,
          durable: { workflowId: "mode", storeDir },
        }),
      (error: unknown) =>
        error instanceof WorkflowError &&
        error.code === "unsupported_mode" &&
        error.message.includes("a2aDelegationEnabled"),
    );
  });
});

class ScriptedExecutor implements AgentExecutor {
  calls = 0;

  constructor(
    private readonly payload: {
      objective: string;
      relevantPaths: string[];
      findings: Array<{ path: string; observation: string }>;
    },
  ) {}

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    this.calls += 1;
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const userMessage = requestContext.userMessage;
    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        artifacts: [],
        history: [userMessage],
        metadata: undefined,
      }),
    );
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }),
    );
    eventBus.publish(
      AgentEvent.artifactUpdate({
        taskId,
        contextId,
        append: false,
        lastChunk: true,
        metadata: undefined,
        artifact: {
          artifactId: "artifact-1",
          name: "ImpactAnalysis",
          description: "scripted",
          extensions: [],
          metadata: undefined,
          parts: [
            {
              content: { $case: "data", value: this.payload },
              metadata: undefined,
              filename: "",
              mediaType: "application/json",
            },
          ],
        },
      }),
    );
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }),
    );
  }

  cancelTask = async (): Promise<void> => {};
}

async function startApp(
  allowedRoot: string,
  cardFor: (baseUrl: string) => AgentCard,
  executor: AgentExecutor,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const app = createImpactApp({
    agentCard: cardFor(baseUrl),
    executor,
  });
  const server = await listen(app, port);
  return {
    baseUrl,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function listen(app: Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function tempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a2a-repo-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "app.ts"),
    "export const status = 500;\n",
  );
  return root;
}

function harnessConfig(root: string): HarnessConfig {
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(targetSrcRoot, { recursive: true });
  fs.mkdirSync(path.join(root, "traces"), { recursive: true });
  return {
    apiKey: "unused",
    model: "unused",
    maxTurns: 2,
    maxRepairAttempts: 1,
    maxReviewRepairAttempts: 1,
    repoRoot: root,
    targetAppRoot,
    targetSrcRoot,
    tracesDir: path.join(root, "traces"),
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
