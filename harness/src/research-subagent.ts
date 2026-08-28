import OpenAI from "openai";
import type {
  Response,
  ResponseOutputItem,
  ResponseUsage,
} from "openai/resources/responses/responses.js";
import type { HarnessConfig } from "./config.ts";
import {
  DiscoveryTracker,
  mergeTokenUsage,
  type InspectedPaths,
  type RepositoryMap,
  type TokenUsageSummary,
} from "./context.ts";
import {
  RESEARCH_CHILD_MAX_TURNS,
  SUBMIT_EVIDENCE_REPORT_TOOL,
  admitEvidenceReport,
  formatEvidenceObservation,
  formatResearchHandoff,
  parseSubmitEvidenceReport,
  type EvidenceReport,
} from "./evidence.ts";
import { resolveModel, routingTraceFields } from "./model-routing.ts";
import { RESEARCH_CHILD_INSTRUCTIONS } from "./research-instructions.ts";
import { READ_ONLY_TOOL_DEFINITIONS, executeReadOnlyTool } from "./tools.ts";
import type { Tracer } from "./trace.ts";

export const RESEARCH_CHILD_TOOLS = [
  ...READ_ONLY_TOOL_DEFINITIONS,
  SUBMIT_EVIDENCE_REPORT_TOOL,
];

export type ResearchChildFailure =
  | "max_turns_exceeded"
  | "model_error"
  | "invalid_report";

export type ResearchDelegationOutcome =
  | "accepted"
  | "denied_budget"
  | "invalid_args"
  | "invalid_report"
  | "max_turns_exceeded"
  | "model_error";

export type ResearchDelegationRecord = {
  parentEpisode: "implementation";
  objective: string;
  scope: string;
  childModel: string;
  grantedTools: string[];
  turnBudget: number;
  childTurns: number;
  childModelCalls: number;
  childToolCalls: number;
  childTokenUsage: TokenUsageSummary | null;
  childDurationMs: number;
  inspectedPaths: InspectedPaths;
  report: EvidenceReport | null;
  outcome: ResearchDelegationOutcome;
  failureReason: string | null;
  workspaceRoot: string;
};

export type ResearchSubagentResult = {
  ok: boolean;
  output: string;
  record: ResearchDelegationRecord;
};

type FunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

type ChildResponsesCreateFn = (request: {
  model: string;
  instructions: string;
  input: unknown;
  tools: unknown;
  previous_response_id?: string;
}) => Promise<Response>;

export function executeResearchTool(
  config: HarnessConfig,
  name: string,
  argsJson: string,
) {
  if (name === "submit_evidence_report") {
    const parsed = parseSubmitEvidenceReport(argsJson);
    if (!parsed.ok) {
      return { ok: false as const, output: parsed.error, report: null };
    }
    return {
      ok: true as const,
      output: formatEvidenceObservation(parsed.value),
      report: parsed.value,
    };
  }
  if (name !== "list_files" && name !== "read_file") {
    return {
      ok: false as const,
      output: `Research child may only call list_files, read_file, or submit_evidence_report. Tool not allowed: ${name}`,
      report: null,
    };
  }
  const result = executeReadOnlyTool(config, name, argsJson);
  return { ...result, report: null };
}

export function deniedResearchDelegation(options: {
  objective: string;
  scope: string;
  childModel: string;
  workspaceRoot: string;
  reason: string;
}): ResearchDelegationRecord {
  return {
    parentEpisode: "implementation",
    objective: options.objective,
    scope: options.scope,
    childModel: options.childModel,
    grantedTools: RESEARCH_CHILD_TOOLS.map((tool) => tool.name),
    turnBudget: RESEARCH_CHILD_MAX_TURNS,
    childTurns: 0,
    childModelCalls: 0,
    childToolCalls: 0,
    childTokenUsage: null,
    childDurationMs: 0,
    inspectedPaths: { readFiles: [], listedPaths: [] },
    report: null,
    outcome: "denied_budget",
    failureReason: options.reason,
    workspaceRoot: options.workspaceRoot,
  };
}

export async function runResearchSubagent(options: {
  config: HarnessConfig;
  objective: string;
  scope: string;
  tracer: Tracer;
  repositoryMap?: RepositoryMap;
  responsesCreate?: ChildResponsesCreateFn;
}): Promise<ResearchSubagentResult> {
  const { config, objective, scope, tracer } = options;
  const startedAt = Date.now();
  const selection = resolveModel("research", config);
  const createResponse =
    options.responsesCreate ?? defaultResponsesCreate(config.apiKey);
  const discovery = new DiscoveryTracker();
  let tokenUsage: TokenUsageSummary | null = null;

  let input: Array<Record<string, unknown>> = [
    {
      role: "user",
      content: formatResearchHandoff({
        objective,
        scope,
        repositoryMap: options.repositoryMap,
      }),
    },
  ];

  let turns = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let modelFinalResponse = "";
  let report: EvidenceReport | null = null;
  let failureReason: ResearchChildFailure | undefined;

  tracer.record("research_child_started", {
    parentEpisode: "implementation",
    ...routingTraceFields(selection),
    objective,
    scope,
    grantedTools: RESEARCH_CHILD_TOOLS.map((tool) => tool.name),
    turnBudget: RESEARCH_CHILD_MAX_TURNS,
    workspaceRoot: config.repoRoot,
    targetAppRoot: config.targetAppRoot,
  });

  try {
    while (turns < RESEARCH_CHILD_MAX_TURNS) {
      turns += 1;
      modelCalls += 1;

      tracer.record(
        "research_child_model_call_started",
        routingTraceFields(selection),
        turns,
      );
      const callStarted = Date.now();

      const response = await createResponse({
        model: selection.model,
        instructions: RESEARCH_CHILD_INSTRUCTIONS,
        input,
        tools: RESEARCH_CHILD_TOOLS,
      });

      const durationMs = Date.now() - callStarted;
      const usage = extractUsage(response);
      tokenUsage = mergeTokenUsage(tokenUsage, usage, "research");
      tracer.record(
        "research_child_model_call_completed",
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
        const parsed = parseSubmitEvidenceReport(
          typeof text === "string" ? text : "",
        );
        if (parsed.ok) {
          const admitted = admitEvidenceReport(
            parsed.value,
            discovery.toInspectedPaths().readFiles,
          );
          if (admitted.ok) {
            report = admitted.value;
            modelFinalResponse =
              text || "(structured report from terminal text)";
            break;
          }
          modelFinalResponse = admitted.error;
          input.push({
            role: "user",
            content: admitted.error,
          });
          continue;
        }
        modelFinalResponse = text || "(empty research-child response)";
        input.push({
          role: "user",
          content:
            "Do not reply with prose. Call submit_evidence_report with a valid structured EvidenceReport.",
        });
        continue;
      }

      for (const call of functionCalls) {
        toolCalls += 1;
        const toolStarted = Date.now();
        tracer.record(
          "research_child_tool_call",
          {
            tool: call.name,
            callId: call.call_id,
            arguments: safeArgsPreview(call.arguments),
          },
          turns,
        );

        const result = executeResearchTool(config, call.name, call.arguments);
        if (
          result.ok &&
          (call.name === "list_files" || call.name === "read_file")
        ) {
          discovery.record(call.name, call.arguments, "spec");
        }

        if (call.name === "submit_evidence_report") {
          const admitted =
            result.report === null
              ? { ok: false as const, error: result.output }
              : admitEvidenceReport(
                  result.report,
                  discovery.toInspectedPaths().readFiles,
                );
          const output = admitted.ok
            ? formatEvidenceObservation(admitted.value)
            : admitted.error;
          tracer.record(
            "research_child_tool_result",
            {
              tool: call.name,
              callId: call.call_id,
              ok: admitted.ok,
              durationMs: Date.now() - toolStarted,
              outputPreview: truncate(output, 4000),
            },
            turns,
          );
          if (!admitted.ok) {
            input.push({
              type: "function_call_output",
              call_id: call.call_id,
              output,
            });
            continue;
          }
          report = admitted.value;
          modelFinalResponse = `submit_evidence_report:${report.findings.length}`;
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output,
          });
          break;
        }

        tracer.record(
          "research_child_tool_result",
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

      if (report) {
        break;
      }
    }

    if (!report && failureReason === undefined) {
      failureReason = "max_turns_exceeded";
      modelFinalResponse =
        modelFinalResponse || "Research child stopped: max_turns_exceeded";
    }
  } catch (error) {
    failureReason = "model_error";
    modelFinalResponse = error instanceof Error ? error.message : String(error);
    tracer.record(
      "research_child_model_error",
      { message: modelFinalResponse },
      turns || undefined,
    );
  }

  if (!report && failureReason === undefined) {
    failureReason = "invalid_report";
  }

  const inspectedPaths = discovery.toInspectedPaths();
  const discoveryMetrics = discovery.toMetrics();
  const outcome: ResearchDelegationOutcome = report
    ? "accepted"
    : failureReason === "model_error"
      ? "model_error"
      : failureReason === "max_turns_exceeded"
        ? "max_turns_exceeded"
        : "invalid_report";

  const record: ResearchDelegationRecord = {
    parentEpisode: "implementation",
    objective,
    scope,
    childModel: selection.model,
    grantedTools: RESEARCH_CHILD_TOOLS.map((tool) => tool.name),
    turnBudget: RESEARCH_CHILD_MAX_TURNS,
    childTurns: turns,
    childModelCalls: modelCalls,
    childToolCalls: toolCalls,
    childTokenUsage: tokenUsage,
    childDurationMs: Date.now() - startedAt,
    inspectedPaths,
    report,
    outcome,
    failureReason: report ? null : (failureReason ?? "invalid_report"),
    workspaceRoot: config.repoRoot,
  };

  tracer.record("research_child_completed", {
    outcome,
    failureReason: record.failureReason,
    childTurns: turns,
    childModelCalls: modelCalls,
    childToolCalls: toolCalls,
    childDurationMs: record.childDurationMs,
    inspectedPaths,
    childDiscovery: discoveryMetrics,
    report,
    tokenUsage,
  });

  if (report) {
    return {
      ok: true,
      output: formatEvidenceObservation(report),
      record,
    };
  }

  return {
    ok: false,
    output: `Research child failed: ${record.failureReason ?? "invalid_report"}. ${modelFinalResponse}`,
    record,
  };
}

function defaultResponsesCreate(apiKey: string): ChildResponsesCreateFn {
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
