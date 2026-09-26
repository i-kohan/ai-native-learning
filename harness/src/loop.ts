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
  MAX_RESEARCH_DELEGATIONS,
  RESEARCH_CHILD_MAX_TURNS,
  parseDelegateResearch,
  shouldEnableSubagents,
  workerToolsForEpisode,
} from "./evidence.ts";
import {
  formatProceduralContext,
  skillIdForPhase,
  loadSkill,
  toSkillLoadRecord,
  type SkillLoadRecord,
} from "./skills.ts";
import { resolveModel, routingTraceFields } from "./model-routing.ts";
import { WORKER_RESEARCH_INSTRUCTIONS } from "./research-instructions.ts";
import {
  deniedResearchDelegation,
  runResearchSubagent,
  type ResearchDelegationRecord,
} from "./research-subagent.ts";
import {
  DELEGATE_REMOTE_ANALYSIS_TOOL,
  WORKER_A2A_INSTRUCTIONS,
  delegateRemoteAnalysis,
  parseDelegateRemoteAnalysis,
  type A2aDelegationRecord,
} from "./a2a/delegation.ts";
import {
  openRepoReadSession,
  REPO_READ_TOOL_NAME,
  type RepoReadSession,
} from "./mcp/repo-read-host.ts";
import { executeTool } from "./tools.ts";
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
  researchDelegations: ResearchDelegationRecord[];
  a2aDelegations: A2aDelegationRecord[];
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
  /** Experiment-only Worker capability. Default architecture does not expose it. */
  subagentsEnabled?: boolean;
  /**
   * Experiment-only. Implementation Worker reads files through admitted MCP
   * repo_read_file instead of direct read_file. Default remains direct tools.
   */
  mcpRepoReadEnabled?: boolean;
  /**
   * Experiment-only. Implementation Worker may delegate one bounded impact
   * analysis over A2A. Default remains no remote delegation.
   */
  a2aDelegationEnabled?: boolean;
  /**
   * Experiment-only advisory hint. Included only for the implementation phase.
   * Absent on the default path.
   */
  memoryHint?: string | null;
  /** Test injection only. Production uses the OpenAI Responses client. */
  responsesCreate?: ResponsesCreateFn;
}): Promise<AgentRunResult> {
  const { config, task, runId, spec, reusableContext } = options;
  const phase: EpisodePhase = options.phase ?? "implementation";
  const conversationStateMode: ConversationStateMode =
    options.conversationStateMode ?? "manual";
  const subagentsEnabled = shouldEnableSubagents(
    options.subagentsEnabled === true,
  );
  const mcpRepoReadEnabled =
    options.mcpRepoReadEnabled === true && phase === "implementation";
  const a2aDelegationEnabled =
    options.a2aDelegationEnabled === true && phase === "implementation";
  const startedAt = Date.now();
  const nested = Boolean(options.tracer);
  const tracer = options.tracer ?? new Tracer(config.tracesDir, runId);
  const beforeSnapshot =
    options.beforeSnapshot ?? snapshotDirectory(config.targetSrcRoot);
  const discovery = new DiscoveryTracker();
  let tokenUsage: TokenUsageSummary | null = null;
  const selection = resolveModel(phase, config);
  let tools = workerToolsForEpisode({ phase, subagentsEnabled });
  let mcpSession: RepoReadSession | null = null;
  const researchDelegations: ResearchDelegationRecord[] = [];
  const a2aDelegations: A2aDelegationRecord[] = [];
  let remainingDelegations =
    subagentsEnabled && phase === "implementation"
      ? MAX_RESEARCH_DELEGATIONS
      : 0;
  let remainingA2aDelegations = a2aDelegationEnabled ? 1 : 0;

  const createResponse =
    options.responsesCreate ?? defaultResponsesCreate(config.apiKey);
  const instructions = episodeInstructions(
    phase,
    subagentsEnabled,
    mcpRepoReadEnabled,
    a2aDelegationEnabled,
  );

  const selectedSkillId = skillIdForPhase(phase);
  const loadedSkill = selectedSkillId
    ? loadSkill(config.repoRoot, selectedSkillId)
    : null;
  const skillLoad = loadedSkill ? toSkillLoadRecord(loadedSkill, phase) : null;
  const memoryHint =
    phase === "implementation" && options.memoryHint
      ? options.memoryHint
      : null;

  const taskContent = [
    reusableContext ? formatImplementationHints(reusableContext) : null,
    memoryHint,
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
      memoryHintProvided: Boolean(memoryHint),
      conversationStateMode,
      subagentsEnabled,
      a2aDelegationEnabled,
    });
  }

  try {
    if (mcpRepoReadEnabled) {
      mcpSession = await openRepoReadSession({
        allowedRoot: config.targetAppRoot,
      });
      if (
        mcpSession.tools.length !== 1 ||
        mcpSession.tools[0]?.name !== REPO_READ_TOOL_NAME
      ) {
        throw new Error("MCP host admission did not expose repo_read_file.");
      }
      tools = workerToolsForEpisode({
        phase,
        subagentsEnabled,
        mcpRepoReadTools: mcpSession.tools,
      });
      tracer.record("mcp_repo_read_admitted", {
        protocolRevision: mcpSession.protocolRevision() ?? null,
        protocolEra: mcpSession.protocolEra() ?? null,
        admittedTools: mcpSession.tools.map((tool) => tool.name),
        replacedDirectTools: ["read_file"],
      });
    }
    if (a2aDelegationEnabled) {
      tools = [...tools, DELEGATE_REMOTE_ANALYSIS_TOOL];
    }

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
        tools,
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

        const result = await executeWorkerTool({
          config,
          workflowId: runId,
          remainingDelegations,
          remainingA2aDelegations,
          subagentsEnabled,
          a2aDelegationEnabled,
          mcpSession,
          name: call.name,
          argsJson: call.arguments,
          tracer,
          reusableContext,
          responsesCreate: options.responsesCreate,
        });
        if (result.delegation) {
          researchDelegations.push(result.delegation);
          remainingDelegations = 0;
        }
        if (result.a2aDelegation) {
          a2aDelegations.push(result.a2aDelegation);
          remainingA2aDelegations = 0;
        }
        if (
          result.ok &&
          (call.name === "list_files" ||
            call.name === "read_file" ||
            call.name === "repo_read_file" ||
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
  } finally {
    await mcpSession?.close();
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
    researchDelegations,
    a2aDelegations,
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
      researchDelegations: result.researchDelegations,
      a2aDelegations: result.a2aDelegations.map((delegation) => ({
        workflowId: delegation.workflowId,
        delegationId: delegation.delegationId,
        taskId: delegation.taskId,
        contextId: delegation.contextId,
        remotePid: delegation.remotePid,
        cardDiscovered: delegation.cardDiscovered,
        admission: delegation.admission,
        admissionReason: delegation.admissionReason,
        sendMessagePerformed: delegation.sendMessagePerformed,
        taskTerminalState: delegation.taskTerminalState,
        artifactAdmission: delegation.artifactAdmission,
        outcome: delegation.outcome,
        grantsWorkflowSuccess: delegation.grantsWorkflowSuccess,
      })),
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

function episodeInstructions(
  phase: EpisodePhase,
  subagentsEnabled: boolean,
  mcpRepoReadEnabled: boolean,
  a2aDelegationEnabled: boolean,
): string {
  if (phase === "repair") {
    return REPAIR_INSTRUCTIONS;
  }
  if (phase === "review_repair") {
    return REVIEW_REPAIR_INSTRUCTIONS;
  }
  let base = subagentsEnabled
    ? `${AGENT_INSTRUCTIONS.trim()}\n${WORKER_RESEARCH_INSTRUCTIONS.trim()}\n`
    : AGENT_INSTRUCTIONS;
  if (mcpRepoReadEnabled) {
    base = `${base.trim()}\nRead repository files with repo_read_file. Path is relative to target-app/. There is no read_file tool in this episode.\n`;
  }
  if (!a2aDelegationEnabled) {
    return base;
  }
  return `${base.trim()}\n${WORKER_A2A_INSTRUCTIONS}\n`;
}

async function executeWorkerTool(options: {
  config: HarnessConfig;
  workflowId: string;
  remainingDelegations: number;
  remainingA2aDelegations: number;
  subagentsEnabled: boolean;
  a2aDelegationEnabled: boolean;
  mcpSession: RepoReadSession | null;
  name: string;
  argsJson: string;
  tracer: Tracer;
  reusableContext?: ReusableContext;
  responsesCreate?: ResponsesCreateFn;
}): Promise<{
  ok: boolean;
  output: string;
  delegation?: ResearchDelegationRecord;
  a2aDelegation?: A2aDelegationRecord;
}> {
  if (options.mcpSession && options.name === "read_file") {
    return {
      ok: false,
      output: "read_file is not exposed for this episode. Use repo_read_file.",
    };
  }
  if (options.name === REPO_READ_TOOL_NAME) {
    if (!options.mcpSession) {
      return {
        ok: false,
        output: "repo_read_file is not admitted for this episode.",
      };
    }
    return options.mcpSession.call(options.name, options.argsJson);
  }
  if (options.name === "delegate_remote_analysis") {
    return executeRemoteAnalysisTool(options);
  }
  if (options.name !== "delegate_research") {
    return executeTool(options.config, options.name, options.argsJson);
  }
  if (!options.subagentsEnabled) {
    return executeTool(options.config, options.name, options.argsJson);
  }

  const parsed = parseDelegateResearch(options.argsJson);
  const objective = parsed.ok ? parsed.value.objective : "";
  const scope = parsed.ok ? parsed.value.scope : "";
  const childModel = resolveModel("research", options.config).model;

  if (options.remainingDelegations <= 0) {
    const reason =
      "delegate_research denied: at most one research delegation is allowed per Worker implementation episode.";
    options.tracer.record("research_delegation_requested", {
      parentEpisode: "implementation",
      objective,
      scope,
      denied: true,
      reason,
    });
    return {
      ok: false,
      output: reason,
      delegation: deniedResearchDelegation({
        objective,
        scope,
        childModel,
        workspaceRoot: options.config.repoRoot,
        reason,
      }),
    };
  }

  if (!parsed.ok) {
    const record: ResearchDelegationRecord = {
      ...deniedResearchDelegation({
        objective,
        scope,
        childModel,
        workspaceRoot: options.config.repoRoot,
        reason: parsed.error,
      }),
      outcome: "invalid_args",
    };
    options.tracer.record("research_delegation_requested", {
      parentEpisode: "implementation",
      objective,
      scope,
      denied: true,
      reason: parsed.error,
    });
    return { ok: false, output: parsed.error, delegation: record };
  }

  options.tracer.record("research_delegation_requested", {
    parentEpisode: "implementation",
    objective: parsed.value.objective,
    scope: parsed.value.scope,
    denied: false,
    childModel,
    grantedTools: ["list_files", "read_file", "submit_evidence_report"],
    turnBudget: RESEARCH_CHILD_MAX_TURNS,
  });

  const child = await runResearchSubagent({
    config: options.config,
    objective: parsed.value.objective,
    scope: parsed.value.scope,
    tracer: options.tracer,
    repositoryMap: options.reusableContext?.repositoryMap,
    responsesCreate: options.responsesCreate,
  });
  return {
    ok: child.ok,
    output: child.output,
    delegation: child.record,
  };
}

async function executeRemoteAnalysisTool(options: {
  config: HarnessConfig;
  workflowId: string;
  remainingA2aDelegations: number;
  a2aDelegationEnabled: boolean;
  argsJson: string;
  tracer: Tracer;
}): Promise<{
  ok: boolean;
  output: string;
  a2aDelegation?: A2aDelegationRecord;
}> {
  if (!options.a2aDelegationEnabled) {
    return executeTool(
      options.config,
      "delegate_remote_analysis",
      options.argsJson,
    );
  }
  const parsed = parseDelegateRemoteAnalysis(options.argsJson);
  if (options.remainingA2aDelegations <= 0) {
    const output =
      "delegate_remote_analysis denied: at most one remote impact delegation is allowed per Worker implementation episode.";
    options.tracer.record("a2a_delegation", {
      workflowId: options.workflowId,
      denied: true,
      reason: output,
    });
    return { ok: false, output };
  }
  if (!parsed.ok) {
    options.tracer.record("a2a_delegation", {
      workflowId: options.workflowId,
      denied: true,
      reason: parsed.error,
    });
    return { ok: false, output: parsed.error };
  }
  const result = await delegateRemoteAnalysis({
    config: options.config,
    workflowId: options.workflowId,
    objective: parsed.value.objective,
    scope: parsed.value.scope,
  });
  options.tracer.record("a2a_delegation", {
    workflowId: result.record.workflowId,
    delegationId: result.record.delegationId,
    taskId: result.record.taskId,
    contextId: result.record.contextId,
    remotePid: result.record.remotePid,
    cardDiscovered: result.record.cardDiscovered,
    agentName: result.record.agentName,
    protocolVersion: result.record.protocolVersion,
    binding: result.record.binding,
    admission: result.record.admission,
    admissionReason: result.record.admissionReason,
    sendMessagePerformed: result.record.sendMessagePerformed,
    taskTerminalState: result.record.taskTerminalState,
    artifactAdmission: result.record.artifactAdmission,
    outcome: result.record.outcome,
    grantsWorkflowSuccess: result.record.grantsWorkflowSuccess,
  });
  return result;
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
