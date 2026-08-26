import OpenAI from "openai";
import type { HarnessConfig } from "./config.ts";
import { AGENT_INSTRUCTIONS, REPAIR_INSTRUCTIONS } from "./instructions.ts";
import { REVIEW_REPAIR_INSTRUCTIONS } from "./review-instructions.ts";
import type { Spec } from "./spec.ts";
import {
  DiscoveryTracker,
  formatImplementationHints,
  mergeTokenUsage,
  type ReusableContext,
  type TokenUsageSummary,
} from "./context.ts";
import {
  formatProceduralContext,
  skillIdForPhase,
  loadSkill,
  toSkillLoadRecord,
  type SkillLoadRecord,
} from "./skills.ts";
import { resolveModel, routingTraceFields } from "./model-routing.ts";
import { TOOL_DEFINITIONS, executeTool } from "./tools.ts";
import { Tracer } from "./trace.ts";
import { diffSnapshots, snapshotDirectory, type FileSnapshot } from "./diff.ts";
import {
  ResponseOutputItem,
  ResponseUsage,
  Response,
} from "openai/resources/responses/responses.js";

export type EpisodePhase = "implementation" | "repair" | "review_repair";
export type RunStatus = "success" | "failure";

/**
 * How this agent episode transports conversation state to the next Responses call.
 * Episode-local only. Not workflow state; a new runAgentLoop starts a new chain.
 */
export type ConversationStateMode = "manual" | "previous_response_id";

export type FunctionCallOutputItem = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type ResponsesCreateRequest = {
  model: string;
  instructions: string;
  input: unknown;
  tools: unknown;
  previous_response_id?: string;
};

export type ResponsesCreateResult = {
  id: string;
  output?: Array<Record<string, unknown>>;
  output_text?: string;
  usage?: ResponseUsage;
};

export type ResponsesCreateFn = (
  request: ResponsesCreateRequest,
) => Promise<Response>;

export type AgentRunResult = {
  task: string;
  phase: EpisodePhase;
  /**
   * Episode stop status only. "success" means a terminal model response.
   * Verified workflow completion is owned by the outer harness, not this loop.
   */
  status: RunStatus;
  failureReason?: "max_turns_exceeded" | "model_error";
  turns: number;
  modelCalls: number;
  toolCalls: number;
  /**
   * Model returned a non-tool (terminal) message.
   * This means the agent episode stopped — not that the workflow is verified.
   */
  receivedTerminalResponse: boolean;
  modelFinalResponse: string;
  changedFiles: string[];
  unifiedDiff: string;
  tracePath: string;
  durationMs: number;
  discovery: ReturnType<DiscoveryTracker["toMetrics"]>;
  implNavCallsBeforeFirstWrite: number | null;
  tokenUsage: TokenUsageSummary | null;
  skillLoad: SkillLoadRecord | null;
  conversationStateMode: ConversationStateMode;
  clientInputItemsSent: number;
  clientInputBytesSent: number;
};

type FunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

export async function runAgentLoop(options: {
  config: HarnessConfig;
  task: string;
  runId: string;
  beforeSnapshot?: FileSnapshot;
  spec?: Spec;
  tracer?: Tracer;
  reusableContext?: ReusableContext;
  phase?: EpisodePhase;
  conversationStateMode?: ConversationStateMode;
  /** Test injection only. Production uses the OpenAI Responses client. */
  responsesCreate?: ResponsesCreateFn;
}): Promise<AgentRunResult> {
  const { config, task, runId, spec, reusableContext } = options;
  const phase: EpisodePhase = options.phase ?? "implementation";
  const conversationStateMode: ConversationStateMode =
    options.conversationStateMode ?? "manual";
  const startedAt = Date.now();
  const nested = Boolean(options.tracer);
  const tracer = options.tracer ?? new Tracer(config.tracesDir, runId);
  const beforeSnapshot =
    options.beforeSnapshot ?? snapshotDirectory(config.targetSrcRoot);
  const discovery = new DiscoveryTracker();
  let tokenUsage: TokenUsageSummary | null = null;
  const selection = resolveModel(phase, config);

  const createResponse =
    options.responsesCreate ?? defaultResponsesCreate(config.apiKey);
  const instructions =
    phase === "repair"
      ? REPAIR_INSTRUCTIONS
      : phase === "review_repair"
        ? REVIEW_REPAIR_INSTRUCTIONS
        : AGENT_INSTRUCTIONS;

  const selectedSkillId = skillIdForPhase(phase);
  const loadedSkill = selectedSkillId
    ? loadSkill(config.repoRoot, selectedSkillId)
    : null;
  const skillLoad = loadedSkill ? toSkillLoadRecord(loadedSkill, phase) : null;

  const taskContent = [
    reusableContext ? formatImplementationHints(reusableContext) : null,
    loadedSkill ? formatProceduralContext(loadedSkill) : null,
    task,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  // Conversation input for the Responses API. Tool results are appended here.
  let input: Array<Record<string, unknown>> =
    initialConversationInput(taskContent);
  let previousResponseId: string | null = null;
  let clientInputItemsSent = 0;
  let clientInputBytesSent = 0;

  let turns = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let modelFinalResponse = "";
  let receivedTerminalResponse = false;
  let failureReason: AgentRunResult["failureReason"];

  if (skillLoad) {
    tracer.record("skill_loaded", skillLoad);
  }

  if (!nested) {
    tracer.record("run_started", {
      task,
      ...routingTraceFields(selection),
      maxTurns: config.maxTurns,
      phase,
      conversationStateMode,
      ...(spec ? { specStatus: "provided" } : {}),
    });
  } else if (phase === "implementation") {
    tracer.record("implementation_started", {
      ...routingTraceFields(selection),
      specGoal: spec?.goal ?? null,
      requirementCount: spec?.requirements.length ?? 0,
      reusableContextProvided: Boolean(reusableContext),
      conversationStateMode,
    });
  }

  try {
    // Explicit agent loop: model → (tool → observation → model)* → final
    while (turns < config.maxTurns) {
      turns += 1;
      modelCalls += 1;

      const inputMetrics = measureClientInput(input);
      clientInputItemsSent += inputMetrics.clientInputItemCount;
      clientInputBytesSent += inputMetrics.clientInputBytes;
      const request = buildResponsesRequest({
        model: selection.model,
        instructions,
        input,
        tools: TOOL_DEFINITIONS,
        mode: conversationStateMode,
        previousResponseId,
      });

      tracer.record(
        "model_call_started",
        {
          ...routingTraceFields(selection),
          phase,
          conversationStateMode,
          previousResponseId,
          ...inputMetrics,
        },
        turns,
      );
      const callStarted = Date.now();

      const response = await createResponse(request);

      const durationMs = Date.now() - callStarted;
      const usage = extractUsage(response);
      tokenUsage = mergeTokenUsage(
        tokenUsage,
        usage,
        phase === "review_repair" ? "review_repair" : phase,
      );

      tracer.record(
        "model_call_completed",
        {
          durationMs,
          responseId: response.id,
          conversationStateMode,
          previousResponseId,
          ...inputMetrics,
          ...(usage ? { usage } : {}),
        },
        turns,
      );

      previousResponseId = nextPreviousResponseId(
        conversationStateMode,
        response.id,
      );

      const outputItems = (response.output ?? []) as Array<FunctionCallItem>;
      input = applyModelOutput(conversationStateMode, input, outputItems);

      const functionCalls = outputItems.filter(
        (item): item is FunctionCallItem => item.type === "function_call",
      );

      // No tool calls → this agent episode stopped. Not verified completion.
      if (functionCalls.length === 0) {
        modelFinalResponse = extractText(response) || "(empty final response)";
        receivedTerminalResponse = true;
        tracer.record(
          "model_final",
          {
            phase,
            response: modelFinalResponse,
            receivedTerminalResponse: true,
            modelClaimedDone: true,
          },
          turns,
        );
        break;
      }

      // Execute each requested tool and return observations to the model.
      const toolOutputs: FunctionCallOutputItem[] = [];
      for (const call of functionCalls) {
        toolCalls += 1;
        const toolStarted = Date.now();
        const argsPreview = safeArgsPreview(call.name, call.arguments);

        tracer.record(
          "tool_call",
          {
            phase,
            tool: call.name,
            callId: call.call_id,
            arguments: argsPreview,
          },
          turns,
        );

        const result = executeTool(config, call.name, call.arguments);
        if (
          result.ok &&
          (call.name === "list_files" ||
            call.name === "read_file" ||
            call.name === "write_file")
        ) {
          discovery.record(call.name, call.arguments, "implementation");
        }

        tracer.record(
          "tool_result",
          {
            tool: call.name,
            callId: call.call_id,
            ok: result.ok,
            durationMs: Date.now() - toolStarted,
            outputPreview: truncate(result.output, 4000),
          },
          turns,
        );

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: result.output,
        });
      }
      input = applyToolOutputs(conversationStateMode, input, toolOutputs);

      // Next while-iteration starts the next model inference with tool results.
    }

    if (!receivedTerminalResponse) {
      failureReason = "max_turns_exceeded";
      modelFinalResponse =
        modelFinalResponse || "Agent stopped: max_turns_exceeded";
      tracer.record("model_final", {
        phase,
        response: modelFinalResponse,
        receivedTerminalResponse: false,
        modelClaimedDone: false,
        failureReason,
      });
    }
  } catch (error) {
    failureReason = "model_error";
    modelFinalResponse = error instanceof Error ? error.message : String(error);
    tracer.record(
      "model_error",
      { phase, message: modelFinalResponse },
      turns || undefined,
    );
  }

  const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
  const { changedFiles, unifiedDiff } = diffSnapshots(
    beforeSnapshot,
    afterSnapshot,
  );

  const status: RunStatus =
    receivedTerminalResponse && failureReason === undefined
      ? "success"
      : "failure";

  if (status === "failure" && failureReason === undefined) {
    failureReason = "max_turns_exceeded";
  }

  const implDiscovery = discovery.toMetrics();

  const result: AgentRunResult = {
    task,
    phase,
    status,
    failureReason,
    turns,
    modelCalls,
    toolCalls,
    receivedTerminalResponse,
    modelFinalResponse,
    changedFiles,
    unifiedDiff,
    tracePath: tracer.tracePath,
    durationMs: Date.now() - startedAt,
    discovery: implDiscovery,
    implNavCallsBeforeFirstWrite: discovery.getImplNavCallsBeforeFirstWrite(),
    tokenUsage,
    skillLoad,
    conversationStateMode,
    clientInputItemsSent,
    clientInputBytesSent,
  };

  if (!nested) {
    tracer.record("run_completed", {
      phase,
      status: result.status,
      failureReason: result.failureReason ?? null,
      turns: result.turns,
      modelCalls: result.modelCalls,
      toolCalls: result.toolCalls,
      receivedTerminalResponse: result.receivedTerminalResponse,
      changedFiles: result.changedFiles,
      durationMs: result.durationMs,
      implDiscovery,
      implNavCallsBeforeFirstWrite: result.implNavCallsBeforeFirstWrite,
      tokenUsage,
      skillLoad: result.skillLoad,
      conversationStateMode,
      clientInputItemsSent,
      clientInputBytesSent,
    });
    await tracer.close();
  }
  return result;
}

export function printRunResult(result: AgentRunResult): void {
  console.log("\n=== Agent Episode Result ===");
  console.log(`task: ${truncate(result.task, 200)}`);
  console.log(`phase: ${result.phase}`);
  console.log(`episode_status: ${result.status}`);
  if (result.failureReason) {
    console.log(`failure_reason: ${result.failureReason}`);
  }
  console.log(`turns/model_calls: ${result.turns}/${result.modelCalls}`);
  console.log(`tool_calls: ${result.toolCalls}`);
  console.log(`conversation_state_mode: ${result.conversationStateMode}`);
  console.log(
    `client_input: items=${result.clientInputItemsSent} bytes=${result.clientInputBytesSent}`,
  );
  console.log(`received_terminal_response: ${result.receivedTerminalResponse}`);
  console.log(
    `changed_files: ${result.changedFiles.length ? result.changedFiles.join(", ") : "(none)"}`,
  );
  if (result.unifiedDiff.trim()) {
    console.log("--- diff ---");
    console.log(result.unifiedDiff);
    console.log("--- end diff ---");
  }
  console.log(`trace: ${result.tracePath}`);
  console.log(`duration_ms: ${result.durationMs}`);
  console.log(`model_final_response:\n${result.modelFinalResponse}`);
}

export function initialConversationInput(
  taskContent: string,
): Array<Record<string, unknown>> {
  return [{ role: "user", content: taskContent }];
}

export function applyModelOutput(
  mode: ConversationStateMode,
  input: Array<Record<string, unknown>>,
  outputItems: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (mode === "previous_response_id") {
    return [];
  }
  return [...input, ...outputItems];
}

export function applyToolOutputs(
  mode: ConversationStateMode,
  input: Array<Record<string, unknown>>,
  toolOutputs: FunctionCallOutputItem[],
): Array<Record<string, unknown>> {
  if (mode === "previous_response_id") {
    return [...toolOutputs];
  }
  return [...input, ...toolOutputs];
}

export function nextPreviousResponseId(
  mode: ConversationStateMode,
  responseId: string,
): string | null {
  return mode === "previous_response_id" ? responseId : null;
}

export function measureClientInput(input: Array<Record<string, unknown>>): {
  clientInputItemCount: number;
  clientInputBytes: number;
} {
  return {
    clientInputItemCount: input.length,
    clientInputBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
  };
}

export function buildResponsesRequest(options: {
  model: string;
  instructions: string;
  input: Array<Record<string, unknown>>;
  tools: unknown;
  mode: ConversationStateMode;
  previousResponseId: string | null;
}): ResponsesCreateRequest {
  return {
    model: options.model,
    instructions: options.instructions,
    input: options.input,
    tools: options.tools,
    ...(options.mode === "previous_response_id" && options.previousResponseId
      ? { previous_response_id: options.previousResponseId }
      : {}),
  };
}

function defaultResponsesCreate(apiKey: string): ResponsesCreateFn {
  const client = new OpenAI({ apiKey });
  return async (request) =>
    client.responses.create({
      model: request.model,
      instructions: request.instructions,
      input: request.input as never,
      tools: request.tools as never,
      ...(request.previous_response_id
        ? { previous_response_id: request.previous_response_id }
        : {}),
    });
}

function extractText(response: {
  output_text?: string;
  output?: Array<ResponseOutputItem>;
}): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }
    const content = item.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractUsage(response: {
  usage?: ResponseUsage;
}): Record<string, unknown> | null {
  if (!response.usage || typeof response.usage !== "object") {
    return null;
  }
  return { ...response.usage };
}

function safeArgsPreview(toolName: string, argsJson: string): unknown {
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    if (toolName === "write_file" && typeof parsed.content === "string") {
      return {
        path: parsed.path,
        contentLength: parsed.content.length,
        contentPreview: truncate(parsed.content, 500),
      };
    }
    return parsed;
  } catch {
    return truncate(argsJson, 500);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}
