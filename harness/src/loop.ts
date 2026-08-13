import OpenAI from "openai";
import type { HarnessConfig } from "./config.ts";
import { AGENT_INSTRUCTIONS } from "./instructions.ts";
import { TOOL_DEFINITIONS, executeTool } from "./tools.ts";
import { Tracer } from "./trace.ts";
import { runFinalVerification, type VerificationResult } from "./verify.ts";
import { diffSnapshots, snapshotDirectory, type FileSnapshot } from "./diff.ts";
import {
  ResponseOutputItem,
  ResponseUsage,
} from "openai/resources/responses/responses.js";

export type RunStatus = "success" | "failure";

export type AgentRunResult = {
  task: string;
  status: RunStatus;
  failureReason?:
    | "max_turns_exceeded"
    | "final_verification_failed"
    | "model_error";
  turns: number;
  modelCalls: number;
  toolCalls: number;
  modelClaimedDone: boolean;
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult | null;
  modelFinalResponse: string;
  changedFiles: string[];
  unifiedDiff: string;
  tracePath: string;
  durationMs: number;
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
}): Promise<AgentRunResult> {
  const { config, task, runId } = options;
  const startedAt = Date.now();
  const tracer = new Tracer(config.tracesDir, runId);
  const beforeSnapshot =
    options.beforeSnapshot ?? snapshotDirectory(config.targetSrcRoot);

  const client = new OpenAI({ apiKey: config.apiKey });

  // Conversation input for the Responses API. Tool results are appended here.
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
  let modelClaimedDone = false;
  let failureReason: AgentRunResult["failureReason"];

  tracer.record("run_started", {
    task,
    model: config.model,
    maxTurns: config.maxTurns,
  });

  try {
    // Explicit agent loop: model → (tool → observation → model)* → final
    while (turns < config.maxTurns) {
      turns += 1;
      modelCalls += 1;

      tracer.record("model_call_started", { model: config.model }, turns);
      const callStarted = Date.now();

      const response = await client.responses.create({
        model: config.model,
        instructions: AGENT_INSTRUCTIONS,
        input: input as never,
        tools: TOOL_DEFINITIONS as never,
      });

      const durationMs = Date.now() - callStarted;
      const usage = extractUsage(response);

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

      // No tool calls → model produced a final response. Stop the loop.
      if (functionCalls.length === 0) {
        modelFinalResponse = extractText(response) || "(empty final response)";
        modelClaimedDone = true;
        tracer.record(
          "model_final",
          { response: modelFinalResponse, modelClaimedDone: true },
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
            tool: call.name,
            callId: call.call_id,
            arguments: argsPreview,
          },
          turns,
        );

        const result = executeTool(config, call.name, call.arguments);

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

    if (!modelClaimedDone) {
      failureReason = "max_turns_exceeded";
      modelFinalResponse =
        modelFinalResponse || "Agent stopped: max_turns_exceeded";
      tracer.record("model_final", {
        response: modelFinalResponse,
        modelClaimedDone: false,
        failureReason,
      });
    }
  } catch (error) {
    failureReason = "model_error";
    modelFinalResponse = error instanceof Error ? error.message : String(error);
    tracer.record(
      "model_error",
      { message: modelFinalResponse },
      turns || undefined,
    );
  }

  // Independent final verification — do not trust the model's claim of completion.
  const finalVerification = runFinalVerification(config);
  tracer.record("final_verification", {
    passed: finalVerification.passed,
    exitCode: finalVerification.exitCode,
    durationMs: finalVerification.durationMs,
    outputPreview: truncate(finalVerification.output, 4000),
    modelClaimedDone,
  });

  if (modelClaimedDone && !finalVerification.passed) {
    failureReason = "final_verification_failed";
  } else if (!modelClaimedDone && failureReason === undefined) {
    failureReason = "max_turns_exceeded";
  }

  const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
  const { changedFiles, unifiedDiff } = diffSnapshots(
    beforeSnapshot,
    afterSnapshot,
  );

  const status: RunStatus =
    modelClaimedDone && finalVerification.passed && failureReason === undefined
      ? "success"
      : "failure";

  if (status === "failure" && failureReason === undefined) {
    failureReason = "final_verification_failed";
  }

  const result: AgentRunResult = {
    task,
    status,
    failureReason,
    turns,
    modelCalls,
    toolCalls,
    modelClaimedDone,
    finalVerificationPassed: finalVerification.passed,
    finalVerification,
    modelFinalResponse,
    changedFiles,
    unifiedDiff,
    tracePath: tracer.tracePath,
    durationMs: Date.now() - startedAt,
  };

  tracer.record("run_completed", {
    status: result.status,
    failureReason: result.failureReason ?? null,
    turns: result.turns,
    modelCalls: result.modelCalls,
    toolCalls: result.toolCalls,
    modelClaimedDone: result.modelClaimedDone,
    finalVerificationPassed: result.finalVerificationPassed,
    changedFiles: result.changedFiles,
    durationMs: result.durationMs,
  });

  await tracer.close();
  return result;
}

export function printRunResult(result: AgentRunResult): void {
  console.log("\n=== V0 Harness Result ===");
  console.log(`task: ${truncate(result.task, 200)}`);
  console.log(`status: ${result.status}`);
  if (result.failureReason) {
    console.log(`failure_reason: ${result.failureReason}`);
  }
  console.log(`turns/model_calls: ${result.turns}/${result.modelCalls}`);
  console.log(`tool_calls: ${result.toolCalls}`);
  console.log(
    `final_tests: ${result.finalVerificationPassed ? "PASS" : "FAIL"} (exit ${result.finalVerification?.exitCode ?? "n/a"})`,
  );
  console.log(`model_claimed_done: ${result.modelClaimedDone}`);
  console.log(
    `final_verification_agreed: ${result.modelClaimedDone && result.finalVerificationPassed}`,
  );
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
