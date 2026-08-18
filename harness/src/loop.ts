import OpenAI from "openai";
import type { HarnessConfig } from "./config.ts";
import { AGENT_INSTRUCTIONS } from "./instructions.ts";
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
  /**
   * V0 stop signal only: model returned a non-tool (terminal) message.
   * This is NOT the same as "task is done" — clarification / blocked /
   * "please confirm" also end here. Distinguishing those is out of scope for V0.
   */
  receivedTerminalResponse: boolean;
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult | null;
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
}): Promise<AgentRunResult> {
  const { config, task, runId, spec, reusableContext } = options;
  const startedAt = Date.now();
  const nested = Boolean(options.tracer);
  const tracer = options.tracer ?? new Tracer(config.tracesDir, runId);
  const beforeSnapshot =
    options.beforeSnapshot ?? snapshotDirectory(config.targetSrcRoot);
  const discovery = new DiscoveryTracker();
  let tokenUsage: TokenUsageSummary | null = null;

  const client = new OpenAI({ apiKey: config.apiKey });

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
      ...(spec ? { specStatus: "provided" } : {}),
    });
  } else {
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
      tokenUsage = mergeTokenUsage(tokenUsage, usage, "implementation");

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

      // No tool calls → terminal text response. Stop the loop.
      // V0 limitation: "done" and "need clarification" look the same here.
      if (functionCalls.length === 0) {
        modelFinalResponse = extractText(response) || "(empty final response)";
        receivedTerminalResponse = true;
        tracer.record(
          "model_final",
          {
            response: modelFinalResponse,
            receivedTerminalResponse: true,
            // Kept for older trace readers; not a true completion claim.
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
      { message: modelFinalResponse },
      turns || undefined,
    );
  }

  // Independent final verification — tests are truth; terminal text is not.
  const finalVerification = runFinalVerification(config);
  tracer.record("final_verification", {
    passed: finalVerification.passed,
    exitCode: finalVerification.exitCode,
    durationMs: finalVerification.durationMs,
    outputPreview: truncate(finalVerification.output, 4000),
    receivedTerminalResponse,
  });

  if (receivedTerminalResponse && !finalVerification.passed) {
    failureReason = "final_verification_failed";
  } else if (!receivedTerminalResponse && failureReason === undefined) {
    failureReason = "max_turns_exceeded";
  }

  const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
  const { changedFiles, unifiedDiff } = diffSnapshots(
    beforeSnapshot,
    afterSnapshot,
  );

  // V0 success = loop ended with a terminal message AND tests pass.
  // A clarification-only terminal on a green fixture would still look like success.
  const status: RunStatus =
    receivedTerminalResponse &&
    finalVerification.passed &&
    failureReason === undefined
      ? "success"
      : "failure";

  if (status === "failure" && failureReason === undefined) {
    failureReason = "final_verification_failed";
  }

  const implDiscovery = discovery.toMetrics();

  const result: AgentRunResult = {
    task,
    status,
    failureReason,
    turns,
    modelCalls,
    toolCalls,
    receivedTerminalResponse,
    finalVerificationPassed: finalVerification.passed,
    finalVerification,
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
      status: result.status,
      failureReason: result.failureReason ?? null,
      turns: result.turns,
      modelCalls: result.modelCalls,
      toolCalls: result.toolCalls,
      receivedTerminalResponse: result.receivedTerminalResponse,
      finalVerificationPassed: result.finalVerificationPassed,
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
  console.log(`received_terminal_response: ${result.receivedTerminalResponse}`);
  console.log(
    `terminal_and_tests_pass: ${result.receivedTerminalResponse && result.finalVerificationPassed}`,
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
