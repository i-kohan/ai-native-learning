import fs from "node:fs";
import OpenAI from "openai";
import { resolveWithin, toRepoRelative } from "./paths.ts";
import { normalizeRepoPath } from "./investigation-report.ts";

const MAX_READ_CHARS = 12_000;
const MAX_LIST_ENTRIES = 200;
const SKIP_LIST_NAMES = new Set([
  ".git",
  "node_modules",
  ".worktrees",
  "traces",
  "dist",
  "coverage",
]);

const DENIED_TOOLS = [
  "write_file",
  "run_command",
  "delegate_research",
  "delegate_remote_analysis",
  "spawn_worker",
] as const;

export const INVESTIGATION_WORKER_TOOL_NAMES = [
  "list_files",
  "read_file",
  "submit_investigation_report",
] as const;

export type InvestigationResponsesCreate = (request: {
  model: string;
  instructions: string;
  input: unknown;
  tools: unknown;
}) => Promise<InvestigationModelResponse>;

export type InvestigationModelResponse = {
  id?: string;
  output?: Array<Record<string, unknown>>;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

export type InvestigationToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
};

export type EpisodeRunResult = {
  ok: boolean;
  value: unknown;
  failureReason: string | null;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  pathsRead: string[];
  observedReads: string[];
  startedAt: number;
  finishedAt: number;
};

export function investigationReadToolDefinitions(): InvestigationToolDefinition[] {
  return [LIST_FILES_TOOL, READ_FILE_TOOL];
}

export function workerToolDefinitions(
  submitTool: InvestigationToolDefinition,
): InvestigationToolDefinition[] {
  return [...investigationReadToolDefinitions(), submitTool];
}

export function executeInvestigationTool(options: {
  repoRoot: string;
  name: string;
  argsJson: string;
  observedReads: string[];
  pathsRead: string[];
}): { ok: boolean; output: string } {
  if ((DENIED_TOOLS as readonly string[]).includes(options.name)) {
    return {
      ok: false,
      output: `Tool not available to investigation workers: ${options.name}`,
    };
  }
  if (options.name !== "list_files" && options.name !== "read_file") {
    return {
      ok: false,
      output: `Tool not available to investigation workers: ${options.name}`,
    };
  }
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(options.argsJson) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, output: "Tool arguments must be an object." };
    }
    args = parsed;
  } catch {
    return { ok: false, output: "Tool arguments must be valid JSON." };
  }
  if (options.name === "list_files") {
    return listInvestigationFiles(options.repoRoot, String(args.path ?? "."));
  }
  return readInvestigationFile(
    options.repoRoot,
    String(args.path ?? ""),
    options.observedReads,
    options.pathsRead,
  );
}

export async function runInvestigationEpisode(options: {
  model: string;
  instructions: string;
  userContent: string;
  tools: InvestigationToolDefinition[];
  maxTurns: number;
  repoRoot: string;
  responsesCreate: InvestigationResponsesCreate;
  submitToolName: string;
  acceptSubmission: (
    argsJson: string,
    observedReads: string[],
  ) => { ok: true; value: unknown } | { ok: false; error: string };
}): Promise<EpisodeRunResult> {
  const startedAt = Date.now();
  const observedReads: string[] = [];
  const pathsRead: string[] = [];
  let input: Array<Record<string, unknown>> = [
    { role: "user", content: options.userContent },
  ];
  let modelCalls = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let value: unknown = null;
  let failureReason: string | null = null;

  try {
    while (modelCalls < options.maxTurns && value === null) {
      modelCalls += 1;
      const response = await options.responsesCreate({
        model: options.model,
        instructions: options.instructions,
        input,
        tools: options.tools,
      });
      const usage = readUsage(response);
      inputTokens += usage.input;
      outputTokens += usage.output;
      input = [...input, ...(response.output ?? [])];

      const calls = functionCallsOf(response);
      if (calls.length === 0) {
        input.push({
          role: "user",
          content: `Do not reply with prose. Call ${options.submitToolName} with the structured report.`,
        });
        continue;
      }

      const advertised = new Set(options.tools.map((tool) => tool.name));
      for (const call of calls) {
        toolCalls += 1;
        if (!advertised.has(call.name)) {
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: `Tool not available to this episode: ${call.name}`,
          });
          continue;
        }
        if (call.name === options.submitToolName) {
          const admitted = options.acceptSubmission(
            call.arguments,
            observedReads,
          );
          const output = admitted.ok
            ? "Accepted structured report."
            : admitted.error;
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output,
          });
          if (admitted.ok) {
            value = admitted.value;
          }
          continue;
        }

        const result = executeInvestigationTool({
          repoRoot: options.repoRoot,
          name: call.name,
          argsJson: call.arguments,
          observedReads,
          pathsRead,
        });
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: result.output,
        });
      }
      if (value !== null) {
        break;
      }
    }
    if (value === null && failureReason === null) {
      failureReason = "max_turns_exceeded";
    }
  } catch (error) {
    if (value === null) {
      const message = error instanceof Error ? error.message : String(error);
      failureReason = `model_error: ${message}`;
    }
  }

  return {
    ok: value !== null,
    value,
    failureReason: value !== null ? null : failureReason,
    modelCalls,
    toolCalls,
    inputTokens,
    outputTokens,
    pathsRead,
    observedReads: [...observedReads],
    startedAt,
    finishedAt: Date.now(),
  };
}

export function defaultInvestigationResponsesCreate(
  apiKey: string,
): InvestigationResponsesCreate {
  const client = new OpenAI({ apiKey });
  return async (request) => {
    const response = await client.responses.create({
      model: request.model,
      instructions: request.instructions,
      input: request.input as never,
      tools: request.tools as never,
    });
    return response as unknown as InvestigationModelResponse;
  };
}

const LIST_FILES_TOOL: InvestigationToolDefinition = {
  type: "function",
  name: "list_files",
  description:
    "List one repository directory. Path is relative to the repository root. Use '.' for the root.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Repository-relative directory.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  strict: true,
};

const READ_FILE_TOOL: InvestigationToolDefinition = {
  type: "function",
  name: "read_file",
  description:
    "Read a UTF-8 repository file. Path is relative to the repository root. The harness truncates long files and records the read for provenance.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Repository-relative file path.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  strict: true,
};

function listInvestigationFiles(
  repoRoot: string,
  relativePath: string,
): {
  ok: boolean;
  output: string;
} {
  try {
    const target = resolveWithin(
      repoRoot,
      relativePath === "" ? "." : relativePath,
    );
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      return { ok: false, output: `Directory does not exist: ${relativePath}` };
    }
    const entries = fs
      .readdirSync(target, { withFileTypes: true })
      .filter((entry) => !SKIP_LIST_NAMES.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    const shown = entries.slice(0, MAX_LIST_ENTRIES);
    const lines = shown.map((entry) => {
      const rel = toRepoRelative(repoRoot, `${target}/${entry.name}`);
      return entry.isDirectory() ? `${rel}/` : rel;
    });
    if (entries.length > shown.length) {
      lines.push(`…[truncated ${entries.length - shown.length} entries]`);
    }
    return { ok: true, output: lines.join("\n") || "(empty)" };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function readInvestigationFile(
  repoRoot: string,
  relativePath: string,
  observedReads: string[],
  pathsRead: string[],
): { ok: boolean; output: string } {
  try {
    const target = resolveWithin(repoRoot, relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return { ok: false, output: `File does not exist: ${relativePath}` };
    }
    const buffer = fs.readFileSync(target);
    if (buffer.subarray(0, 8000).includes(0)) {
      return { ok: false, output: `Not a UTF-8 text file: ${relativePath}` };
    }
    const relative = normalizeRepoPath(toRepoRelative(repoRoot, target));
    pathsRead.push(relative);
    if (!observedReads.includes(relative)) {
      observedReads.push(relative);
    }
    const text = buffer.toString("utf8");
    if (text.length <= MAX_READ_CHARS) {
      return { ok: true, output: text };
    }
    return {
      ok: true,
      output: `${text.slice(0, MAX_READ_CHARS)}\n…[truncated by harness read limit]`,
    };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function functionCallsOf(response: InvestigationModelResponse): Array<{
  call_id: string;
  name: string;
  arguments: string;
}> {
  const calls: Array<{ call_id: string; name: string; arguments: string }> = [];
  for (const item of response.output ?? []) {
    if (item.type !== "function_call") {
      continue;
    }
    if (typeof item.call_id !== "string" || typeof item.name !== "string") {
      continue;
    }
    calls.push({
      call_id: item.call_id,
      name: item.name,
      arguments: typeof item.arguments === "string" ? item.arguments : "{}",
    });
  }
  return calls;
}

function readUsage(response: InvestigationModelResponse): {
  input: number;
  output: number;
} {
  return {
    input:
      typeof response.usage?.input_tokens === "number"
        ? response.usage.input_tokens
        : 0,
    output:
      typeof response.usage?.output_tokens === "number"
        ? response.usage.output_tokens
        : 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
