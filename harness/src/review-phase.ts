import OpenAI from "openai";
import type {
  ResponseOutputItem,
  ResponseUsage,
} from "openai/resources/responses/responses.js";
import type { HarnessConfig } from "./config.ts";
import { mergeTokenUsage, type TokenUsageSummary } from "./context.ts";
import { REVIEWER_INSTRUCTIONS } from "./review-instructions.ts";
import {
  SUBMIT_REVIEW_TOOL,
  formatReviewContext,
  parseReviewPayload,
  parseSubmitReview,
  type ReviewContext,
  type ReviewResult,
} from "./review.ts";
import type { Tracer } from "./trace.ts";

export type ReviewPhaseResult = {
  result: ReviewResult | null;
  parseOk: boolean;
  failureReason?: "max_turns_exceeded" | "model_error" | "invalid_review";
  modelCalls: number;
  toolCalls: number;
  durationMs: number;
  tokenUsage: TokenUsageSummary | null;
  modelFinalResponse: string;
};

type FunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

const MAX_REVIEW_TURNS = 4;

export async function runIndependentReview(options: {
  config: HarnessConfig;
  context: ReviewContext;
  tracer: Tracer;
  round: number;
}): Promise<ReviewPhaseResult> {
  const { config, context, tracer, round } = options;
  const startedAt = Date.now();
  const client = new OpenAI({ apiKey: config.apiKey });
  let tokenUsage: TokenUsageSummary | null = null;

  let input: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: formatReviewContext(context),
    },
  ];

  let turns = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let modelFinalResponse = "";
  let review: ReviewResult | null = null;
  let failureReason: ReviewPhaseResult["failureReason"];

  tracer.record("review_started", {
    round,
    changedFiles: context.changedFiles,
    constraintIds: context.architectureConstraints.map((item) => item.id),
    verificationPassed: context.verificationEvidence.passed,
    promptIncludesSpec: true,
    promptIncludesDiff: true,
    promptIncludesConstraints: context.architectureConstraints.length > 0,
    promptIncludesVerificationEvidence: true,
  });

  try {
    while (turns < MAX_REVIEW_TURNS) {
      turns += 1;
      modelCalls += 1;

      tracer.record(
        "review_model_call_started",
        { model: config.model, round },
        turns,
      );
      const callStarted = Date.now();

      const response = await client.responses.create({
        model: config.model,
        instructions: REVIEWER_INSTRUCTIONS,
        input: input as never,
        tools: [SUBMIT_REVIEW_TOOL] as never,
      });

      const durationMs = Date.now() - callStarted;
      const usage = extractUsage(response);
      tokenUsage = mergeTokenUsage(tokenUsage, usage, "review");
      tracer.record(
        "review_model_call_completed",
        {
          round,
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
        const parsed = parseReviewPayload(tryParseJson(text));
        if (parsed.ok) {
          review = parsed.value;
          modelFinalResponse = text || "(structured review from terminal text)";
          break;
        }
        modelFinalResponse = text || "(empty review response)";
        input.push({
          role: "user",
          content:
            "Do not reply with prose. Call submit_review with a valid structured ReviewResult.",
        });
        continue;
      }

      for (const call of functionCalls) {
        toolCalls += 1;
        const toolStarted = Date.now();

        if (call.name !== "submit_review") {
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: `Reviewer may only call submit_review. Tool not allowed: ${call.name}`,
          });
          continue;
        }

        const parsed = parseSubmitReview(call.arguments);
        tracer.record(
          "review_tool_call",
          {
            tool: call.name,
            callId: call.call_id,
            round,
            arguments: parsed.ok
              ? {
                  status: parsed.value.status,
                  findingCount: parsed.value.findings.length,
                  findingKeys: parsed.value.findings.map(
                    (item) => item.findingKey,
                  ),
                }
              : { invalid: true },
          },
          turns,
        );

        if (!parsed.ok) {
          tracer.record(
            "review_tool_result",
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

        review = parsed.value;
        tracer.record(
          "review_tool_result",
          {
            tool: call.name,
            callId: call.call_id,
            ok: true,
            durationMs: Date.now() - toolStarted,
            outputPreview: `accepted:${review.status}:${review.findings.length}`,
          },
          turns,
        );
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: `Review accepted: ${review.status}`,
        });
        modelFinalResponse = `submit_review:${review.status}`;
        break;
      }

      if (review) {
        break;
      }
    }

    if (!review && failureReason === undefined) {
      failureReason = "max_turns_exceeded";
      modelFinalResponse =
        modelFinalResponse || "Review stopped: max_turns_exceeded";
    }
  } catch (error) {
    failureReason = "model_error";
    modelFinalResponse = error instanceof Error ? error.message : String(error);
    tracer.record(
      "review_model_error",
      { round, message: modelFinalResponse },
      turns || undefined,
    );
  }

  if (!review && failureReason === undefined) {
    failureReason = "invalid_review";
  }

  return {
    result: review,
    parseOk: review !== null,
    failureReason,
    modelCalls,
    toolCalls,
    durationMs: Date.now() - startedAt,
    tokenUsage,
    modelFinalResponse,
  };
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return text;
      }
    }
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
