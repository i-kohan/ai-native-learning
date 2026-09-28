import type { HarnessConfig } from "./config.ts";
import {
  defaultInvestigationResponsesCreate,
  runInvestigationEpisode,
  workerToolDefinitions,
  type EpisodeRunResult,
  type InvestigationResponsesCreate,
  type InvestigationToolDefinition,
} from "./investigation-episode.ts";
import {
  admitChildInvestigationReport,
  admitInvestigationReportPaths,
  enforceIncompleteCoverage,
  normalizeRepoPath,
  parseInvestigationReport,
  reportedChildEvidencePaths,
  type ChildInvestigationReport,
  type InvestigationReport,
} from "./investigation-report.ts";
import {
  SUBMIT_CHILD_REPORT_TOOL,
  SUBMIT_FINAL_REPORT_TOOL,
  SUBMIT_SWARM_PLAN_TOOL,
} from "./investigation-tools.ts";
import {
  admitSwarmPlan,
  SWARM_INVESTIGATION_POLICY,
  type SwarmPlan,
  type SwarmWorker,
} from "./swarm-plan.ts";

export type InvestigationUsage = {
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  pathsRead: string[];
};

export type ChildExecutionRecord = {
  id: string;
  objective: string;
  scopeHint: string | null;
  status: "success" | "failure";
  failureReason: string | null;
  report: ChildInvestigationReport | null;
  observedReadPaths: string[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  pathsRead: string[];
  reportBytes: number;
};

export type OverlapEvidence = {
  overlapped: boolean;
  commonOverlapMs: number;
  pairwise: Array<{ a: string; b: string; overlapMs: number }>;
  durationSumMs: number;
  waveWallMs: number;
  durationSumExceedsWaveWall: boolean;
};

export type BaselineInvestigationResult = {
  ok: boolean;
  model: string;
  objective: string;
  report: InvestigationReport | null;
  failureReason: string | null;
  usage: InvestigationUsage;
  observedReadPaths: string[];
  wallMs: number;
};

export type MultiAgentInvestigationResult = {
  ok: boolean;
  model: string;
  objective: string;
  planSource: "lead" | "injected";
  admission: { ok: true; plan: SwarmPlan } | { ok: false; error: string };
  children: ChildExecutionRecord[];
  overlap: OverlapEvidence | null;
  synthesisInput: string | null;
  report: InvestigationReport | null;
  failureReason: string | null;
  usage: InvestigationUsage;
  leadPlanUsage: InvestigationUsage;
  synthesisUsage: InvestigationUsage;
  waveWallMs: number;
  wallMs: number;
};

export async function runBaselineInvestigation(options: {
  config: HarnessConfig;
  objective: string;
  responsesCreate?: InvestigationResponsesCreate;
}): Promise<BaselineInvestigationResult> {
  const started = Date.now();
  const create = resolveCreate(options.config, options.responsesCreate);
  const episode = await runInvestigationEpisode({
    model: options.config.model,
    instructions: BASELINE_INSTRUCTIONS,
    userContent: buildBaselineHandoff(options.objective),
    tools: workerToolDefinitions(SUBMIT_FINAL_REPORT_TOOL),
    maxTurns: SWARM_INVESTIGATION_POLICY.baselineMaxTurns,
    repoRoot: options.config.repoRoot,
    responsesCreate: create,
    submitToolName: SUBMIT_FINAL_REPORT_TOOL.name,
    acceptSubmission: (argsJson, observedReads) =>
      acceptFinalReport(argsJson, observedReads),
  });
  const report = episode.ok ? (episode.value as InvestigationReport) : null;
  return {
    ok: report !== null,
    model: options.config.model,
    objective: options.objective,
    report,
    failureReason: episode.failureReason,
    usage: usageFromEpisode(episode),
    observedReadPaths: episode.observedReads,
    wallMs: Date.now() - started,
  };
}

export async function runMultiAgentInvestigation(options: {
  config: HarnessConfig;
  objective: string;
  responsesCreate?: InvestigationResponsesCreate;
  proposedPlan?: unknown;
  failWorkerIds?: string[];
}): Promise<MultiAgentInvestigationResult> {
  const started = Date.now();
  const model = options.config.model;
  const create = resolveCreate(options.config, options.responsesCreate);
  const planSource = options.proposedPlan === undefined ? "lead" : "injected";
  const leadPlanUsage = emptyUsage();
  let admission: MultiAgentInvestigationResult["admission"];

  if (options.proposedPlan === undefined) {
    const planned = await runInvestigationEpisode({
      model,
      instructions: LEAD_PLAN_INSTRUCTIONS,
      userContent: buildLeadPlanHandoff(options.objective),
      tools: [...workerToolDefinitions(SUBMIT_SWARM_PLAN_TOOL)],
      maxTurns: SWARM_INVESTIGATION_POLICY.leadPlanMaxTurns,
      repoRoot: options.config.repoRoot,
      responsesCreate: create,
      submitToolName: SUBMIT_SWARM_PLAN_TOOL.name,
      acceptSubmission: (argsJson) => acceptSwarmPlan(argsJson),
    });
    addUsage(leadPlanUsage, usageFromEpisode(planned));
    admission = planned.ok
      ? { ok: true, plan: planned.value as SwarmPlan }
      : {
          ok: false,
          error:
            planned.failureReason ??
            "Lead did not submit an admitted SwarmPlan.",
        };
  } else {
    const admitted = admitSwarmPlan(options.proposedPlan);
    admission = admitted.ok
      ? { ok: true, plan: admitted.value }
      : { ok: false, error: admitted.error };
  }

  if (!admission.ok) {
    const usage = emptyUsage();
    addUsage(usage, leadPlanUsage);
    return {
      ok: false,
      model,
      objective: options.objective,
      planSource,
      admission,
      children: [],
      overlap: null,
      synthesisInput: null,
      report: null,
      failureReason: admission.error,
      usage,
      leadPlanUsage,
      synthesisUsage: emptyUsage(),
      waveWallMs: 0,
      wallMs: Date.now() - started,
    };
  }

  const plan = admission.plan;
  const failIds = new Set(options.failWorkerIds ?? []);
  const waveStarted = Date.now();
  const children = await Promise.all(
    plan.workers.map((worker) =>
      runChildWorker({
        worker,
        model,
        repoRoot: options.config.repoRoot,
        responsesCreate: create,
        fail: failIds.has(worker.id),
      }),
    ),
  );
  const waveWallMs = Date.now() - waveStarted;
  const overlap = parallelOverlapOf(children, waveWallMs);
  const synthesisInput = buildSynthesisInput({
    objective: options.objective,
    children,
  });
  const synthesisEpisode = await runInvestigationEpisode({
    model,
    instructions: SYNTHESIS_INSTRUCTIONS,
    userContent: synthesisInput,
    tools: [SUBMIT_FINAL_REPORT_TOOL],
    maxTurns: SWARM_INVESTIGATION_POLICY.synthesisMaxTurns,
    repoRoot: options.config.repoRoot,
    responsesCreate: create,
    submitToolName: SUBMIT_FINAL_REPORT_TOOL.name,
    acceptSubmission: (argsJson) =>
      acceptFinalReport(argsJson, reportedChildEvidencePaths(children)),
  });
  const synthesisUsage = usageFromEpisode(synthesisEpisode);
  const failures = children
    .filter((child) => child.status === "failure")
    .map((child) => ({
      id: child.id,
      reason: child.failureReason ?? "child_failed",
    }));
  const report = synthesisEpisode.ok
    ? enforceIncompleteCoverage(
        synthesisEpisode.value as InvestigationReport,
        failures,
      )
    : null;
  const usage = emptyUsage();
  addUsage(usage, leadPlanUsage);
  for (const child of children) {
    addUsage(usage, {
      modelCalls: child.modelCalls,
      toolCalls: child.toolCalls,
      inputTokens: child.inputTokens,
      outputTokens: child.outputTokens,
      pathsRead: child.pathsRead,
    });
  }
  addUsage(usage, synthesisUsage);

  return {
    ok: report !== null,
    model,
    objective: options.objective,
    planSource,
    admission,
    children,
    overlap,
    synthesisInput,
    report,
    failureReason: report ? null : synthesisEpisode.failureReason,
    usage,
    leadPlanUsage,
    synthesisUsage,
    waveWallMs,
    wallMs: Date.now() - started,
  };
}

export function buildBaselineHandoff(objective: string): string {
  return [
    "Investigation objective:",
    objective,
    "",
    "Produce one InvestigationReport through submit_investigation_report.",
    "Cite only repository files you have read.",
  ].join("\n");
}

export function buildLeadPlanHandoff(objective: string): string {
  return [
    "Investigation objective:",
    objective,
    "",
    "Propose 2 or 3 workers with different slices of this audit.",
    "Call submit_swarm_plan. Do not write the final InvestigationReport.",
  ].join("\n");
}

export function buildWorkerHandoff(worker: SwarmWorker): string {
  return [
    `Worker id: ${worker.id}`,
    "Objective:",
    worker.objective,
    "",
    "Scope hint:",
    worker.scopeHint ?? "(none)",
    "",
    "You do not have the Lead's reasoning or any other worker's findings.",
    "Read the repository, then call submit_investigation_report.",
  ].join("\n");
}

export function buildSynthesisInput(options: {
  objective: string;
  children: ChildExecutionRecord[];
}): string {
  const sections = [
    "Investigation objective:",
    options.objective,
    "",
    "Admitted child reports and failures follow. Conversations are not included.",
  ];
  for (const child of options.children) {
    sections.push(
      "",
      `## Worker ${child.id}`,
      `status: ${child.status}`,
      `objective: ${child.objective}`,
    );
    if (child.status === "failure") {
      sections.push(`failure: ${child.failureReason ?? "child_failed"}`);
      sections.push("findings: none");
    } else {
      sections.push(JSON.stringify(child.report));
    }
  }
  const failed = options.children.filter((child) => child.status === "failure");
  if (failed.length > 0) {
    sections.push(
      "",
      `Incomplete coverage: workers failed (${failed.map((child) => child.id).join(", ")}).`,
      "The final report must not claim full coverage.",
    );
  }
  return sections.join("\n");
}

export function parallelOverlapOf(
  children: Array<
    Pick<ChildExecutionRecord, "id" | "startedAt" | "finishedAt" | "durationMs">
  >,
  waveWallMs: number,
): OverlapEvidence {
  const pairwise: OverlapEvidence["pairwise"] = [];
  for (let left = 0; left < children.length; left += 1) {
    for (let right = left + 1; right < children.length; right += 1) {
      const overlapMs = intervalOverlapMs(children[left], children[right]);
      if (overlapMs > 0) {
        pairwise.push({
          a: children[left].id,
          b: children[right].id,
          overlapMs,
        });
      }
    }
  }
  const durationSumMs = children.reduce(
    (sum, child) => sum + child.durationMs,
    0,
  );
  const commonOverlapMs =
    children.length === 0
      ? 0
      : Math.max(
          0,
          Math.min(...children.map((child) => child.finishedAt)) -
            Math.max(...children.map((child) => child.startedAt)),
        );
  return {
    overlapped: pairwise.length > 0,
    commonOverlapMs,
    pairwise,
    durationSumMs,
    waveWallMs,
    durationSumExceedsWaveWall: durationSumMs > waveWallMs,
  };
}

export function pathReadMetrics(paths: string[]): {
  pathsRead: string[];
  uniquePathsRead: string[];
  duplicatePathReads: string[];
} {
  const counts = new Map<string, number>();
  for (const item of paths) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return {
    pathsRead: paths,
    uniquePathsRead: [...counts.keys()].sort(),
    duplicatePathReads: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([item]) => item)
      .sort(),
  };
}

export function workerCoverageOverlap(
  children: ChildExecutionRecord[],
): string[] {
  const counts = new Map<string, number>();
  for (const child of children) {
    for (const item of new Set(child.observedReadPaths)) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([item]) => item)
    .sort();
}

export function evaluateSwm01LiveMechanism(
  result: MultiAgentInvestigationResult,
): Record<string, boolean> {
  const toolNames = workerInvestigationTools().map((tool) => tool.name);
  const successes = result.children.filter(
    (child) => child.status === "success",
  );
  const readOnly =
    toolNames.length === 3 &&
    toolNames.every((name) =>
      (
        ["list_files", "read_file", "submit_investigation_report"] as string[]
      ).includes(name),
    );
  return {
    leadProposedBoundedPlan: result.admission.ok,
    harnessAdmittedTwoToThree:
      result.admission.ok &&
      result.children.length >= SWARM_INVESTIGATION_POLICY.minWorkers &&
      result.children.length <= SWARM_INVESTIGATION_POLICY.maxWorkers,
    freshWorkersExecuted: result.children.length >= 2,
    workersReadOnly: readOnly,
    workersCannotDelegate:
      !toolNames.includes("delegate_research") &&
      !toolNames.includes("delegate_remote_analysis") &&
      !toolNames.includes("spawn_worker"),
    executionOverlapped: result.overlap?.overlapped === true,
    structuredChildReports:
      successes.length > 0 && successes.every((child) => child.report !== null),
    provenanceRetained: successes.every((child) =>
      (child.report?.findings ?? []).every((finding) =>
        finding.evidencePaths.every((item) =>
          child.observedReadPaths.includes(normalizeRepoPath(item)),
        ),
      ),
    ),
    synthesisReceivesCompressedReports:
      result.synthesisInput !== null &&
      !result.synthesisInput.includes("function_call"),
    leadProducedFinalReport: result.report !== null,
  };
}

export function workerInvestigationTools(): InvestigationToolDefinition[] {
  return workerToolDefinitions(SUBMIT_CHILD_REPORT_TOOL);
}

export function synthesisInvestigationTools(): InvestigationToolDefinition[] {
  return [SUBMIT_FINAL_REPORT_TOOL];
}

async function runChildWorker(options: {
  worker: SwarmWorker;
  model: string;
  repoRoot: string;
  responsesCreate: InvestigationResponsesCreate;
  fail: boolean;
}): Promise<ChildExecutionRecord> {
  const startedAt = Date.now();
  if (options.fail) {
    const finishedAt = Date.now();
    return childRecord({
      worker: options.worker,
      status: "failure",
      failureReason: "injected_failure",
      report: null,
      episode: null,
      startedAt,
      finishedAt,
    });
  }

  const episode = await runInvestigationEpisode({
    model: options.model,
    instructions: WORKER_INSTRUCTIONS,
    userContent: buildWorkerHandoff(options.worker),
    tools: workerInvestigationTools(),
    maxTurns: SWARM_INVESTIGATION_POLICY.workerMaxTurns,
    repoRoot: options.repoRoot,
    responsesCreate: options.responsesCreate,
    submitToolName: SUBMIT_CHILD_REPORT_TOOL.name,
    acceptSubmission: (argsJson, observedReads) =>
      acceptChildReport(argsJson, options.worker.objective, observedReads),
  });
  return childRecord({
    worker: options.worker,
    status: episode.ok ? "success" : "failure",
    failureReason: episode.failureReason,
    report: episode.ok ? (episode.value as ChildInvestigationReport) : null,
    episode,
    startedAt: episode.startedAt,
    finishedAt: episode.finishedAt,
  });
}

function childRecord(options: {
  worker: SwarmWorker;
  status: "success" | "failure";
  failureReason: string | null;
  report: ChildInvestigationReport | null;
  episode: EpisodeRunResult | null;
  startedAt: number;
  finishedAt: number;
}): ChildExecutionRecord {
  return {
    id: options.worker.id,
    objective: options.worker.objective,
    scopeHint: options.worker.scopeHint ?? null,
    status: options.status,
    failureReason: options.status === "success" ? null : options.failureReason,
    report: options.report,
    observedReadPaths: options.episode?.observedReads ?? [],
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    durationMs: options.finishedAt - options.startedAt,
    modelCalls: options.episode?.modelCalls ?? 0,
    toolCalls: options.episode?.toolCalls ?? 0,
    inputTokens: options.episode?.inputTokens ?? 0,
    outputTokens: options.episode?.outputTokens ?? 0,
    pathsRead: options.episode?.pathsRead ?? [],
    reportBytes: options.report ? JSON.stringify(options.report).length : 0,
  };
}

function acceptSwarmPlan(
  argsJson: string,
): { ok: true; value: SwarmPlan } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return {
      ok: false,
      error: "submit_swarm_plan arguments must be valid JSON.",
    };
  }
  return admitSwarmPlan(parsed);
}

function acceptChildReport(
  argsJson: string,
  objective: string,
  observedReads: string[],
):
  | { ok: true; value: ChildInvestigationReport }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return {
      ok: false,
      error: "submit_investigation_report arguments must be valid JSON.",
    };
  }
  return admitChildInvestigationReport({
    value: parsed,
    objective,
    observedReadPaths: observedReads,
  });
}

function acceptFinalReport(
  argsJson: string,
  allowedPaths: string[],
): { ok: true; value: InvestigationReport } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return {
      ok: false,
      error: "submit_investigation_report arguments must be valid JSON.",
    };
  }
  const report = parseInvestigationReport(parsed);
  if (!report.ok) {
    return report;
  }
  return admitInvestigationReportPaths(report.value, allowedPaths);
}

function intervalOverlapMs(
  left: { startedAt: number; finishedAt: number },
  right: { startedAt: number; finishedAt: number },
): number {
  return (
    Math.min(left.finishedAt, right.finishedAt) -
    Math.max(left.startedAt, right.startedAt)
  );
}

function resolveCreate(
  config: HarnessConfig,
  responsesCreate: InvestigationResponsesCreate | undefined,
): InvestigationResponsesCreate {
  return responsesCreate ?? defaultInvestigationResponsesCreate(config.apiKey);
}

function usageFromEpisode(episode: EpisodeRunResult): InvestigationUsage {
  return {
    modelCalls: episode.modelCalls,
    toolCalls: episode.toolCalls,
    inputTokens: episode.inputTokens,
    outputTokens: episode.outputTokens,
    pathsRead: episode.pathsRead,
  };
}

function emptyUsage(): InvestigationUsage {
  return {
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    pathsRead: [],
  };
}

function addUsage(target: InvestigationUsage, extra: InvestigationUsage): void {
  target.modelCalls += extra.modelCalls;
  target.toolCalls += extra.toolCalls;
  target.inputTokens += extra.inputTokens;
  target.outputTokens += extra.outputTokens;
  target.pathsRead.push(...extra.pathsRead);
}

const BASELINE_INSTRUCTIONS = [
  "You are one read-only repository investigator.",
  "Tools: list_files, read_file, submit_investigation_report.",
  "You do not have write_file, run_command, delegate_research, delegate_remote_analysis, spawn_worker, subagents, A2A, or memory.",
  "Cite only files you actually read.",
  "Preserve uncertainties. Do not claim coverage you did not establish.",
].join("\n");

const LEAD_PLAN_INSTRUCTIONS = [
  "You are the Lead for one bounded repository investigation.",
  "Propose a SwarmPlan only. Do not write the final audit.",
  "Call submit_swarm_plan with 2 or 3 workers.",
  "Each worker needs a unique id, a non-empty objective, and a scopeHint string (use an empty string if you have no hint).",
  "Do not choose the model, tools, turn limits, write access, delegation, or the number of rounds.",
  "The harness rejects plans outside 2 to 3 workers.",
  "Split the audit so worker objectives overlap as little as possible.",
].join("\n");

const WORKER_INSTRUCTIONS = [
  "You are a read-only investigation worker with a fresh context.",
  "You have one bounded objective. You cannot see other workers or the Lead's reasoning.",
  "Tools: list_files, read_file, submit_investigation_report.",
  "write_file, run_command, delegate_research, delegate_remote_analysis, and spawn_worker are not available.",
  "Cite only files you actually read with read_file.",
  "Preserve uncertainties. Call submit_investigation_report when done.",
].join("\n");

const SYNTHESIS_INSTRUCTIONS = [
  "You are the Lead synthesizing child investigation reports into one InvestigationReport.",
  "You receive the original objective, admitted child reports, and explicit child failures.",
  "You do not receive child conversations, and you have no repository tools.",
  "Use only evidence paths that appear in successful child reports.",
  "If any child failed, coverage is incomplete. Say so in coverageSummary and uncertainties.",
  "Do not drop a failed child and do not grade your own report.",
  "Call submit_investigation_report.",
].join("\n");
