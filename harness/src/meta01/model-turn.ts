import OpenAI from "openai";
import {
  applyModelOutput,
  applyToolOutputs,
  initialConversationInput,
  type FunctionCallOutputItem,
} from "../loop.ts";

type ToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
};

export type ToolLoopResult = {
  status: "success" | "failure";
  finalText: string;
  modelCalls: number;
  toolCalls: number;
  wallTimeMs: number;
};

export async function runToolLoop(options: {
  apiKey: string;
  model: string;
  instructions: string;
  task: string;
  tools: ToolSpec[];
  maxTurns: number;
  execute: (name: string, args: Record<string, unknown>) => Promise<string>;
}): Promise<ToolLoopResult> {
  const started = Date.now();
  const client = new OpenAI({ apiKey: options.apiKey });
  let input = initialConversationInput(options.task);
  let modelCalls = 0;
  let toolCalls = 0;
  let finalText = "";
  let receivedTerminal = false;

  try {
    while (modelCalls < options.maxTurns) {
      modelCalls += 1;
      const response = await client.responses.create({
        model: options.model,
        instructions: options.instructions,
        input: input as never,
        tools: options.tools as never,
      });
      const output = (response.output ?? []) as unknown as Array<Record<string, unknown>>;
      input = applyModelOutput("manual", input, output);
      const calls = output.filter((item) => item.type === "function_call");
      if (calls.length === 0) {
        finalText = response.output_text?.trim() || "(empty final response)";
        receivedTerminal = true;
        break;
      }
      const toolOutputs: FunctionCallOutputItem[] = [];
      for (const call of calls) {
        toolCalls += 1;
        const name = typeof call.name === "string" ? call.name : "";
        const args = parseArgs(typeof call.arguments === "string" ? call.arguments : "");
        const outputText = await options.execute(name, args);
        toolOutputs.push({
          type: "function_call_output",
          call_id: typeof call.call_id === "string" ? call.call_id : "",
          output: outputText,
        });
      }
      input = applyToolOutputs("manual", input, toolOutputs);
    }
  } catch (error) {
    finalText = error instanceof Error ? error.message : String(error);
  }

  if (!receivedTerminal && finalText === "") {
    finalText = "Agent stopped: max_turns_exceeded";
  }
  return {
    status: receivedTerminal ? "success" : "failure",
    finalText,
    modelCalls,
    toolCalls,
    wallTimeMs: Date.now() - started,
  };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export function functionTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolSpec {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  };
}
