import OpenAI from "openai";
import type { ResponseOutputItem, ResponseUsage } from "openai/resources/responses/responses.js";
import type { HarnessConfig } from "./config.ts";
import { SPEC_INSTRUCTIONS } from "./spec-instructions.ts";
import {
  SUBMIT_SPEC_TOOL,
  enforceSpecDecision,
  parseSpecPayload,
  parseSubmitSpec,
  type SpecDecision,
} from "./spec.ts";
import { READ_ONLY_TOOL_DEFINITIONS, executeReadOnlyTool } from "./tools.ts";
import type { Tracer } from "./trace.ts";

export type SpecPhaseFailure = "max_turns_exceeded" | "model_error" | "invalid_spec";

export type SpecPhaseResult = {
  decision: SpecDecision | null;
  failureReason?: SpecPhaseFailure;
  turns: number;
  modelCalls: number;
  toolCalls: number;
  modelFinalResponse: string;
  durationMs: number;
};

type FunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

const SPEC_TOOLS = [...READ_ONLY_TOOL_DEFINITIONS, SUBMIT_SPEC_TOOL];

export async function buildSpec(options: {
  config: HarnessConfig;
  task: string;
  tracer: Tracer;
}): Promise<SpecPhaseResult> {
  const { config, task, tracer } = options;
  const startedAt = Date.now();
  const client = new OpenAI({ apiKey: config.apiKey });

  let input: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: task,
    },
  ];

  let turns = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let modelFinalResponse = "";
  let decision: SpecDecision | null = null;
  let failureReason: SpecPhaseFailure | undefined;

  tracer.record("spec_phase_started", {
    task,
    model: config.model,
    tools: SPEC_TOOLS.map((tool) => tool.name),
  });

  try {
    while (turns < config.maxTurns) {
      turns += 1;
      modelCalls += 1;

      tracer.record("spec_model_call_started", { model: config.model }, turns);
      const callStarted = Date.now();

      const response = await client.responses.create({
        model: config.model,
        instructions: SPEC_INSTRUCTIONS,
        input: input as never,
        tools: SPEC_TOOLS as never,
      });

      const durationMs = Date.now() - callStarted;
      const usage = extractUsage(response);
      tracer.record(
        "spec_model_call_completed",
        {
          durationMs,
          responseId: response.id,
          ...(usage ? { usage } : {}),
        },
        turns,
      );

      const outputItems = (response.output ?? []) as Array<FunctionCallItem>;
      input = [...input, ...outputItems];

      const functionCalls = outputItems.filter(
        (item): item is FunctionCallItem => item.type === "function_call",
      );

      if (functionCalls.length === 0) {
        const text = extractText(response);
        const parsed = parseSpecPayload(tryParseJson(text));
        if (parsed.ok) {
          decision = enforceSpecDecision(parsed.value);
          modelFinalResponse = text || "(structured spec from terminal text)";
          break;
        }

        modelFinalResponse = text || "(empty spec-phase response)";
        input.push({
          role: "user",
          content:
            "Do not reply with prose. Call submit_spec with a valid structured SpecDecision.",
        });
        continue;
      }

      for (const call of functionCalls) {
        toolCalls += 1;
        const toolStarted = Date.now();

        if (call.name === "submit_spec") {
          const parsed = parseSubmitSpec(call.arguments);
          tracer.record(
            "spec_tool_call",
            {
              tool: call.name,
              callId: call.call_id,
              arguments: parsed.ok
                ? {
                    status: parsed.value.status,
                    ambiguityCount: parsed.value.spec.ambiguities.length,
                  }
                : { invalid: true },
            },
            turns,
          );

          if (!parsed.ok) {
            tracer.record(
              "spec_tool_result",
              {
                tool: call.name,
                callId: call.call_id,
                ok: false,
                durationMs: Date.now() - toolStarted,
                outputPreview: parsed.error,
              },
              turns,
            );
            input.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: parsed.error,
            });
            continue;
          }

          decision = enforceSpecDecision(parsed.value);
          tracer.record(
            "spec_tool_result",
            {
              tool: call.name,
              callId: call.call_id,
              ok: true,
              durationMs: Date.now() - toolStarted,
              outputPreview: `accepted:${decision.status}`,
            },
            turns,
          );
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: `Spec decision accepted: ${decision.status}`,
          });
          modelFinalResponse = `submit_spec:${decision.status}`;
          break;
        }

        tracer.record(
          "spec_tool_call",
          {
            tool: call.name,
            callId: call.call_id,
            arguments: safeArgsPreview(call.arguments),
          },
          turns,
        );

        const result = executeReadOnlyTool(config, call.name, call.arguments);

        tracer.record(
          "spec_tool_result",
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

      if (decision) {
        break;
      }
    }

    if (!decision && failureReason === undefined) {
      failureReason = "max_turns_exceeded";
      modelFinalResponse =
        modelFinalResponse || "Spec phase stopped: max_turns_exceeded";
    }
  } catch (error) {
    failureReason = "model_error";
    modelFinalResponse = error instanceof Error ? error.message : String(error);
    tracer.record("spec_model_error", { message: modelFinalResponse }, turns || undefined);
  }

  if (!decision && failureReason === undefined) {
    failureReason = "invalid_spec";
  }

  tracer.record("spec_decision", {
    status: decision?.status ?? null,
    failureReason: failureReason ?? null,
    spec: decision?.spec ?? null,
    ambiguities: decision?.spec.ambiguities ?? [],
    unresolvedQuestions:
      decision?.status === "needs_human_judgment" ? decision.unresolvedQuestions : [],
    turns,
    modelCalls,
    toolCalls,
  });

  return {
    decision,
    failureReason,
    turns,
    modelCalls,
    toolCalls,
    modelFinalResponse,
    durationMs: Date.now() - startedAt,
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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

function extractUsage(response: { usage?: ResponseUsage }): Record<string, unknown> | null {
  if (!response.usage || typeof response.usage !== "object") {
    return null;
  }
  return { ...response.usage };
}

function safeArgsPreview(argsJson: string): unknown {
  try {
    return JSON.parse(argsJson);
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
