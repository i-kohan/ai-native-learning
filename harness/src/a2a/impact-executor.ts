import {
  TaskState,
  type Artifact,
  type Message,
  type Task,
  type TaskArtifactUpdateEvent,
  type TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import {
  admitImpactArtifact,
  type ImpactAnalysisArtifact,
} from "./artifact.ts";
import { IMPACT_ARTIFACT_NAME } from "./constants.ts";
import { listBoundedFiles, readBoundedFile } from "./impact-files.ts";

const MAX_REMOTE_TURNS = 4;

type RemoteResponse = {
  id: string;
  output?: Array<Record<string, unknown>>;
  output_text?: string;
};

type RemoteCreate = (request: {
  model: string;
  instructions: string;
  input: unknown;
  tools: unknown;
}) => Promise<RemoteResponse>;

type FunctionCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

export class ImpactAnalysisExecutor implements AgentExecutor {
  private readonly contexts = new Map<string, string>();
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly options: {
      allowedRoot: string;
      apiKey: string;
      model: string;
      responsesCreate?: RemoteCreate;
    },
  ) {}

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    this.contexts.set(taskId, contextId);
    const userMessage = requestContext.userMessage;
    publishTask(
      eventBus,
      taskId,
      contextId,
      userMessage,
      TaskState.TASK_STATE_SUBMITTED,
    );
    publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_WORKING);

    try {
      if (this.cancelled.has(taskId)) {
        publishStatus(
          eventBus,
          taskId,
          contextId,
          TaskState.TASK_STATE_CANCELED,
        );
        return;
      }
      const intent = readIntent(userMessage);
      const analysis = await runImpactAnalysisEpisode({
        allowedRoot: this.options.allowedRoot,
        apiKey: this.options.apiKey,
        model: this.options.model,
        objective: intent.objective,
        scope: intent.scope,
        responsesCreate: this.options.responsesCreate,
        shouldStop: () => this.cancelled.has(taskId),
      });
      if (this.cancelled.has(taskId)) {
        publishStatus(
          eventBus,
          taskId,
          contextId,
          TaskState.TASK_STATE_CANCELED,
        );
        return;
      }
      publishArtifact(eventBus, taskId, contextId, analysis);
      publishStatus(
        eventBus,
        taskId,
        contextId,
        TaskState.TASK_STATE_COMPLETED,
      );
    } catch {
      publishStatus(eventBus, taskId, contextId, TaskState.TASK_STATE_FAILED);
    } finally {
      this.cancelled.delete(taskId);
      this.contexts.delete(taskId);
    }
  }

  cancelTask = async (
    taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> => {
    this.cancelled.add(taskId);
    publishStatus(
      eventBus,
      taskId,
      this.contexts.get(taskId) ?? "",
      TaskState.TASK_STATE_CANCELED,
    );
  };
}

export async function runImpactAnalysisEpisode(options: {
  allowedRoot: string;
  apiKey: string;
  model: string;
  objective: string;
  scope: string;
  responsesCreate?: RemoteCreate;
  shouldStop?: () => boolean;
}): Promise<ImpactAnalysisArtifact> {
  if (!options.apiKey.trim() || !options.model.trim()) {
    throw new Error("Remote impact model is not configured.");
  }
  const create = options.responsesCreate ?? defaultRemoteCreate(options.apiKey);
  let input: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: [
        `Objective: ${options.objective}`,
        `Scope: ${options.scope}`,
        "Inspect only the bounded scope with list_files and read_file.",
        "Then call submit_impact_analysis.",
        "Observations are one short sentence each. Do not include hidden reasoning.",
      ].join("\n"),
    },
  ];

  for (let turn = 0; turn < MAX_REMOTE_TURNS; turn += 1) {
    if (options.shouldStop?.()) {
      throw new Error("Remote impact analysis was canceled.");
    }
    const response = await create({
      model: options.model,
      instructions: REMOTE_INSTRUCTIONS,
      input,
      tools: REMOTE_TOOLS,
    });
    const outputItems = response.output ?? [];
    input = [...input, ...outputItems];
    const calls = outputItems.filter(isFunctionCall);
    if (calls.length === 0) {
      input.push({
        role: "user",
        content: "Call submit_impact_analysis. Do not answer with prose.",
      });
      continue;
    }

    for (const call of calls) {
      if (call.name === "submit_impact_analysis") {
        const submitted = parseSubmittedAnalysis(call.arguments);
        if (!submitted.ok) {
          input.push(toolOutput(call.call_id, submitted.error));
          continue;
        }
        const admitted = admitImpactArtifact(submitted.value, {
          allowedRoot: options.allowedRoot,
          scope: options.scope,
        });
        if (!admitted.ok) {
          input.push(toolOutput(call.call_id, admitted.reason));
          continue;
        }
        return admitted.value;
      }
      const result = executeRemoteTool(
        options.allowedRoot,
        options.scope,
        call.name,
        call.arguments,
      );
      input.push(toolOutput(call.call_id, result.output));
    }
  }

  throw new Error("Remote impact analysis did not submit an artifact.");
}

const REMOTE_INSTRUCTIONS = `
You are a separate read-only impact analysis agent.
You inspect a bounded repository scope and submit structured evidence.
You do not write files, run shell commands, verify tests, review diffs, or decide workflow success.
You may only call list_files, read_file, and submit_impact_analysis.
Paths are relative to the configured repository root. Stay inside the requested scope.
`.trim();

const REMOTE_TOOLS = [
  {
    type: "function" as const,
    name: "list_files",
    description: "List a directory inside the delegated scope.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory. Use '.' for the scope root.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "read_file",
    description: "Read a UTF-8 file inside the delegated scope.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "submit_impact_analysis",
    description:
      "Submit the structured impact analysis. This does not change the parent workflow.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        relevantPaths: { type: "array", items: { type: "string" } },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              observation: { type: "string" },
            },
            required: ["path", "observation"],
            additionalProperties: false,
          },
        },
      },
      required: ["objective", "relevantPaths", "findings"],
      additionalProperties: false,
    },
    strict: true,
  },
];

function executeRemoteTool(
  allowedRoot: string,
  scope: string,
  name: string,
  argsJson: string,
): { ok: boolean; output: string } {
  if (name !== "list_files" && name !== "read_file") {
    return { ok: false, output: `Tool not allowed: ${name}` };
  }
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, output: "Tool arguments must be an object." };
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, output: "Tool arguments must be valid JSON." };
  }
  const relativePath = typeof args.path === "string" ? args.path : "";
  if (name === "list_files") {
    return listBoundedFiles(allowedRoot, scope, relativePath);
  }
  return readBoundedFile(allowedRoot, scope, relativePath);
}

function readIntent(message: Message): { objective: string; scope: string } {
  for (const part of message.parts) {
    if (part.content?.$case !== "data" || !isRecord(part.content.value)) {
      continue;
    }
    const objective = part.content.value.objective;
    const scope = part.content.value.scope;
    if (typeof objective === "string" && typeof scope === "string") {
      return { objective, scope };
    }
  }
  throw new Error(
    "Impact request must be a data part with objective and scope.",
  );
}

function parseSubmittedAnalysis(
  argsJson: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(argsJson) as unknown };
  } catch {
    return {
      ok: false,
      error: "submit_impact_analysis arguments must be valid JSON.",
    };
  }
}

function defaultRemoteCreate(apiKey: string): RemoteCreate {
  return async (request) => {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      model: request.model,
      instructions: request.instructions,
      input: request.input as never,
      tools: request.tools as never,
    });
    return {
      id: response.id,
      output: response.output as unknown as
        | Array<Record<string, unknown>>
        | undefined,
      output_text: response.output_text,
    };
  };
}

function publishTask(
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  userMessage: Message,
  state: TaskState,
): void {
  const task: Task = {
    id: taskId,
    contextId,
    status: {
      state,
      message: undefined,
      timestamp: new Date().toISOString(),
    },
    artifacts: [],
    history: [userMessage],
    metadata: undefined,
  };
  eventBus.publish(AgentEvent.task(task));
}

function publishStatus(
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  state: TaskState,
): void {
  const update: TaskStatusUpdateEvent = {
    taskId,
    contextId,
    status: {
      state,
      message: undefined,
      timestamp: new Date().toISOString(),
    },
    metadata: undefined,
  };
  eventBus.publish(AgentEvent.statusUpdate(update));
}

function publishArtifact(
  eventBus: ExecutionEventBus,
  taskId: string,
  contextId: string,
  analysis: ImpactAnalysisArtifact,
): void {
  const artifact: Artifact = {
    artifactId: crypto.randomUUID(),
    name: IMPACT_ARTIFACT_NAME,
    description: "Advisory repository impact analysis.",
    parts: [
      {
        content: { $case: "data", value: analysis },
        metadata: undefined,
        filename: "",
        mediaType: "application/json",
      },
    ],
    metadata: undefined,
    extensions: [],
  };
  const update: TaskArtifactUpdateEvent = {
    taskId,
    contextId,
    artifact,
    append: false,
    lastChunk: true,
    metadata: undefined,
  };
  eventBus.publish(AgentEvent.artifactUpdate(update));
}

function toolOutput(callId: string, output: string): Record<string, unknown> {
  return {
    type: "function_call_output",
    call_id: callId,
    output,
  };
}

function isFunctionCall(value: Record<string, unknown>): value is FunctionCall {
  return (
    value.type === "function_call" &&
    typeof value.call_id === "string" &&
    typeof value.name === "string" &&
    typeof value.arguments === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
