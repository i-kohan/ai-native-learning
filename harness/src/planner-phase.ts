import OpenAI from "openai";
import type {
  ResponseOutputItem,
  ResponseUsage,
} from "openai/resources/responses/responses.js";
import type { HarnessConfig } from "./config.ts";
import {
  DiscoveryTracker,
  mergeTokenUsage,
  type InspectedPaths,
  type PhaseDiscoveryMetrics,
  type RepositoryMap,
  type TokenUsageSummary,
} from "./context.ts";
import { resolveModel, routingTraceFields } from "./model-routing.ts";
import {
  SUBMIT_PLAN_TOOL,
  formatPlannerContext,
  parsePlanPayload,
  parseSubmitPlan,
  type Plan,
} from "./plan.ts";
import { PLANNER_INSTRUCTIONS } from "./planner-instructions.ts";
import type { Spec } from "./spec.ts";
import { READ_ONLY_TOOL_DEFINITIONS, executeReadOnlyTool } from "./tools.ts";
import type { Tracer } from "./trace.ts";

export type PlannerPhaseFailure =
  | "max_turns_exceeded"
  | "model_error"
  | "invalid_plan";

export type PlannerPhaseResult = {
  plan: Plan | null;
  failureReason?: PlannerPhaseFailure;
  turns: number;
  modelCalls: number;
  toolCalls: number;
  modelFinalResponse: string;
  durationMs: number;
  inspectedPaths: InspectedPaths;
  discovery: PhaseDiscoveryMetrics;
  tokenUsage: TokenUsageSummary | null;
};

type FunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

export const PLANNER_TOOLS = [...READ_ONLY_TOOL_DEFINITIONS, SUBMIT_PLAN_TOOL];

export async function buildPlan(options: {
  config: HarnessConfig;
  task: string;
  spec: Spec;
  tracer: Tracer;
  repositoryMap?: RepositoryMap;
  specInspectedPaths?: InspectedPaths;
}): Promise<PlannerPhaseResult> {
  const { config, task, spec, tracer } = options;
  const startedAt = Date.now();
  const selection = resolveModel("plan", config);
  const client = new OpenAI({ apiKey: config.apiKey });
  const discovery = new DiscoveryTracker();
  let tokenUsage: TokenUsageSummary | null = null;

  let input: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: formatPlannerContext({
        originalTask: task,
        spec,
        repositoryMap: options.repositoryMap,
        specInspectedPaths: options.specInspectedPaths,
      }),
    },
  ];

  let turns = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let modelFinalResponse = "";
  let plan: Plan | null = null;
  let failureReason: PlannerPhaseFailure | undefined;

  tracer.record("planner_phase_started", {
    ...routingTraceFields(selection),
    tools: PLANNER_TOOLS.map((tool) => tool.name),
    repositoryMapProvided: Boolean(options.repositoryMap),
    specInspectedPathsProvided: Boolean(options.specInspectedPaths),
  });

  try {
    while (turns < config.maxTurns) {
      turns += 1;
      modelCalls += 1;

      tracer.record(
        "planner_model_call_started",
        routingTraceFields(selection),
        turns,
      );
      const callStarted = Date.now();

      const response = await client.responses.create({
        model: selection.model,
        instructions: PLANNER_INSTRUCTIONS,
        input: input as never,
        tools: PLANNER_TOOLS as never,
      });

      const durationMs = Date.now() - callStarted;
      const usage = extractUsage(response);
      tokenUsage = mergeTokenUsage(tokenUsage, usage, "plan");
      tracer.record(
        "planner_model_call_completed",
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
        const parsed = parsePlanPayload(tryParseJson(text));
        if (parsed.ok) {
          plan = parsed.value;
          modelFinalResponse = text || "(structured plan from terminal text)";
          break;
        }

        modelFinalResponse = text || "(empty planner-phase response)";
        input.push({
          role: "user",
          content:
            "Do not reply with prose. Call submit_plan with a valid structured Plan.",
        });
        continue;
      }

      for (const call of functionCalls) {
        toolCalls += 1;
        const toolStarted = Date.now();

        if (call.name === "submit_plan") {
          const parsed = parseSubmitPlan(call.arguments);
          tracer.record(
            "planner_tool_call",
            {
              tool: call.name,
              callId: call.call_id,
              arguments: parsed.ok
                ? {
                    stepCount: parsed.value.steps.length,
                    likelyFiles: parsed.value.steps.flatMap(
                      (step) => step.likelyFiles,
                    ),
                  }
                : { invalid: true },
            },
            turns,
          );

          if (!parsed.ok) {
            tracer.record(
              "planner_tool_result",
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

          plan = parsed.value;
          tracer.record(
            "planner_tool_result",
            {
              tool: call.name,
              callId: call.call_id,
              ok: true,
              durationMs: Date.now() - toolStarted,
              outputPreview: `accepted:${plan.steps.length} steps`,
            },
            turns,
          );
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: `Plan accepted with ${plan.steps.length} steps.`,
          });
          modelFinalResponse = `submit_plan:${plan.steps.length}`;
          break;
        }

        tracer.record(
          "planner_tool_call",
          {
            tool: call.name,
            callId: call.call_id,
            arguments: safeArgsPreview(call.arguments),
          },
          turns,
        );

        const result = executeReadOnlyTool(config, call.name, call.arguments);
        if (result.ok) {
          discovery.record(call.name, call.arguments, "spec");
        }

        tracer.record(
          "planner_tool_result",
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

      if (plan) {
        break;
      }
    }

    if (!plan && failureReason === undefined) {
      failureReason = "max_turns_exceeded";
      modelFinalResponse =
        modelFinalResponse || "Planner phase stopped: max_turns_exceeded";
    }
  } catch (error) {
    failureReason = "model_error";
    modelFinalResponse = error instanceof Error ? error.message : String(error);
    tracer.record(
      "planner_model_error",
      { message: modelFinalResponse },
      turns || undefined,
    );
  }

  if (!plan && failureReason === undefined) {
    failureReason = "invalid_plan";
  }

  const inspectedPaths = discovery.toInspectedPaths();
  const plannerDiscovery = discovery.toMetrics();

  tracer.record("planner_decision", {
    accepted: Boolean(plan),
    failureReason: failureReason ?? null,
    plan,
    turns,
    modelCalls,
    toolCalls,
    inspectedPaths,
    plannerDiscovery,
    tokenUsage,
  });

  return {
    plan,
    failureReason,
    turns,
    modelCalls,
    toolCalls,
    modelFinalResponse,
    durationMs: Date.now() - startedAt,
    inspectedPaths,
    discovery: plannerDiscovery,
    tokenUsage,
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

function extractUsage(response: {
  usage?: ResponseUsage;
}): Record<string, unknown> | null {
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
