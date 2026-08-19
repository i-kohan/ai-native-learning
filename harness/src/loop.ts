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
import { TOOL_DEFINITIONS, executeTool } from "./tools.ts";
import { Tracer } from "./trace.ts";
import { diffSnapshots, snapshotDirectory, type FileSnapshot } from "./diff.ts";
import {
  ResponseOutputItem,
  ResponseUsage,
} from "openai/resources/responses/responses.js";

export type EpisodePhase = "implementation" | "repair" | "review_repair";
export type RunStatus = "success" | "failure";

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
}): Promise<AgentRunResult> {
  const { config, task, runId, spec, reusableContext } = options;
  const phase: EpisodePhase = options.phase ?? "implementation";
  const startedAt = Date.now();
  const nested = Boolean(options.tracer);
  const tracer = options.tracer ?? new Tracer(config.tracesDir, runId);
  const beforeSnapshot =
    options.beforeSnapshot ?? snapshotDirectory(config.targetSrcRoot);
  const discovery = new DiscoveryTracker();
  let tokenUsage: TokenUsageSummary | null = null;

  const client = new OpenAI({ apiKey: config.apiKey });
  const instructions =
    phase === "repair"
      ? REPAIR_INSTRUCTIONS
      : phase === "review_repair"
        ? REVIEW_REPAIR_INSTRUCTIONS
        : AGENT_INSTRUCTIONS;

  const taskContent = reusableContext
    ? `${formatImplementationHints(reusableContext)}\n\n${task}`
    : task;

  // Conversation input for the Responses API. Tool results are appended here.
  let input: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: taskContent,
    },
  ];

  let turns = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let modelFinalResponse = "";
  let receivedTerminalResponse = false;
  let failureReason: AgentRunResult["failureReason"];

  if (!nested) {
    tracer.record("run_started", {
      task,
      model: config.model,
      maxTurns: config.maxTurns,
      phase,
      ...(spec ? { specStatus: "provided" } : {}),
    });
  } else if (phase === "implementation") {
    tracer.record("implementation_started", {
      specGoal: spec?.goal ?? null,
      requirementCount: spec?.requirements.length ?? 0,
      reusableContextProvided: Boolean(reusableContext),
    });
  }

  try {
    // Explicit agent loop: model → (tool → observation → model)* → final
    while (turns < config.maxTurns) {
      turns += 1;
      modelCalls += 1;

      tracer.record(
        "model_call_started",
        { model: config.model, phase },
        turns,
      );
      const callStarted = Date.now();

      const response = await client.responses.create({
        model: config.model,
        instructions,
        input: input as never,
        tools: TOOL_DEFINITIONS as never,
      });

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
          ...(usage ? { usage } : {}),
        },
        turns,
      );

      const outputItems = (response.output ?? []) as Array<FunctionCallItem>;
      // Feed model output back into the next request input.
      input = [...input, ...outputItems];

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

        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: result.output,
        });
      }

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
