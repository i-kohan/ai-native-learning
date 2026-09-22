import fs from "node:fs";
import path from "node:path";
import type { HarnessConfig } from "./config.ts";
import { combineTokenUsage, type TokenUsageSummary } from "./context.ts";
import { diffSnapshots, snapshotDirectory } from "./diff.ts";
import type { AgentRunResult } from "./loop.ts";
import {
  type FanOutPlan,
  type FanOutSchedule,
  type FanOutUnit,
  unitsInIntegrationOrder,
} from "./fan-out-plan.ts";
import {
  applySourceDelta,
  captureSourceDelta,
  listUncommittedSourceFiles,
  unstageWithoutLosingWork,
  type SourceDelta,
} from "./source-delta.ts";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  readWorkspaceHead,
  resolveBaseRevision,
  type Workspace,
} from "./workspace.ts";

export type ChildEpisodeResult = {
  episode: AgentRunResult;
  verificationPassed: boolean;
  verificationOutput: string;
  repairAttempts: number;
  startedAt: number;
  finishedAt: number;
};

export type ChildArtifact = {
  unitId: string;
  workspaceRoot: string;
  baseRevision: string;
  changedFiles: string[];
  sourceDelta: SourceDelta;
  reviewDiff: string;
  verificationPassed: boolean;
  verificationOutput: string;
  repairAttempts: number;
  durationMs: number;
  modelCalls: number;
  toolCalls: number;
  tokenUsage: TokenUsageSummary | null;
  startedAt: number;
  finishedAt: number;
};

export type FanInConflictReport = {
  failedUnitId: string;
  evidence: string;
  appliedUnitIds: string[];
};

export type FanInReport = {
  ok: boolean;
  durationMs: number;
  appliedUnitIds: string[];
  conflict: FanInConflictReport | null;
  lostChanges: string[];
  integrationChangedFiles: string[];
};

export type FanOutWorkspaceSet = {
  baseRevision: string;
  children: Record<string, Workspace>;
  integration: Workspace;
};

export type FanOutProvenance = {
  baseRevision: string;
  childRevisions: Record<string, string>;
  integrationRevision: string;
  exactBase: boolean;
};

export type FanOutEvidence = {
  schedule: FanOutSchedule;
  plan: FanOutPlan;
  children: ChildArtifact[];
  writeSetOverlap: string[];
  fanIn: FanInReport;
  provenance: FanOutProvenance;
  childIntervalMs: number;
  childDurationSumMs: number;
  ok: boolean;
  failureReason:
    | "child_verification_failed"
    | "fan_in_conflict"
    | "lost_changes"
    | null;
};

export type FanOutExecutionResult = {
  ok: boolean;
  implementation: AgentRunResult | null;
  evidence: FanOutEvidence;
  workspacesCreatedByHarness: Workspace[];
};

export async function executeFanOut(options: {
  plan: FanOutPlan;
  schedule: FanOutSchedule;
  hostRepoRoot: string;
  runId: string;
  parentConfig: HarnessConfig;
  integration: Workspace;
  children?: Record<string, Workspace>;
  prepareWorkspace?: (config: HarnessConfig) => void;
  executeChild: (args: {
    unit: FanOutUnit;
    workspace: Workspace;
    config: HarnessConfig;
  }) => Promise<ChildEpisodeResult>;
}): Promise<FanOutExecutionResult> {
  const owned: Workspace[] = [];
  const children =
    options.children ??
    createChildWorkspaces({
      hostRepoRoot: options.hostRepoRoot,
      runId: options.runId,
      baseRevision: options.plan.baseRevision,
      unitIds: options.plan.units.map((unit) => unit.id),
      owned,
    });

  const provenance = assertExactBaseProvenance({
    baseRevision: options.plan.baseRevision,
    children,
    integration: options.integration,
  });

  const artifacts: ChildArtifact[] = [];
  const episodes: AgentRunResult[] = [];
  const settled = await scheduleFanOutChildren({
    units: options.plan.units,
    schedule: options.schedule,
    runChild: async (unit) => {
      const workspace = requireChildWorkspace(children, unit.id);
      const config = bindConfig(options.parentConfig, workspace);
      options.prepareWorkspace?.(config);
      const before = snapshotDirectory(config.targetSrcRoot);
      const episode = await options.executeChild({ unit, workspace, config });
      const sourceDelta = captureSourceDelta({
        workspaceRoot: workspace.root,
        baseRevision: options.plan.baseRevision,
      });
      const after = snapshotDirectory(config.targetSrcRoot);
      const review = diffSnapshots(before, after);
      const artifact = childArtifactFromEpisode({
        unitId: unit.id,
        workspaceRoot: workspace.root,
        baseRevision: workspace.baseRevision,
        episode,
        sourceDelta,
        reviewDiff: review.unifiedDiff,
      });
      return { artifact, episode: episode.episode };
    },
  });

  for (const item of settled) {
    if (item.status === "rejected") {
      throw item.reason instanceof Error
        ? item.reason
        : new Error(String(item.reason));
    }
    artifacts.push(item.value.artifact);
    episodes.push(item.value.episode);
  }

  const byId = new Map(artifacts.map((item) => [item.unitId, item]));
  const orderedArtifacts = options.plan.units.map((unit) => {
    const artifact = byId.get(unit.id);
    if (!artifact) {
      throw new Error(`Missing child artifact for unit ${unit.id}`);
    }
    return artifact;
  });

  const failedChild = orderedArtifacts.find((item) => !item.verificationPassed);
  const overlap = writeSetOverlap(orderedArtifacts);
  const childIntervalMs = childExecutionInterval(orderedArtifacts);
  const childDurationSumMs = orderedArtifacts.reduce(
    (sum, item) => sum + item.durationMs,
    0,
  );

  if (failedChild) {
    return {
      ok: false,
      implementation: mergeEpisodes(episodes),
      workspacesCreatedByHarness: owned,
      evidence: {
        schedule: options.schedule,
        plan: options.plan,
        children: orderedArtifacts,
        writeSetOverlap: overlap,
        fanIn: {
          ok: false,
          durationMs: 0,
          appliedUnitIds: [],
          conflict: null,
          lostChanges: [],
          integrationChangedFiles: [],
        },
        provenance,
        childIntervalMs,
        childDurationSumMs,
        ok: false,
        failureReason: "child_verification_failed",
      },
    };
  }

  const fanIn = fanInChildDeltas({
    plan: options.plan,
    integration: options.integration,
    children: orderedArtifacts,
  });
  const failureReason = !fanIn.ok
    ? fanIn.conflict
      ? "fan_in_conflict"
      : "lost_changes"
    : null;

  return {
    ok: fanIn.ok,
    implementation: mergeEpisodes(episodes),
    workspacesCreatedByHarness: owned,
    evidence: {
      schedule: options.schedule,
      plan: options.plan,
      children: orderedArtifacts,
      writeSetOverlap: overlap,
      fanIn,
      provenance,
      childIntervalMs,
      childDurationSumMs,
      ok: fanIn.ok,
      failureReason,
    },
  };
}

export function createFanOutWorkspaces(options: {
  hostRepoRoot: string;
  runId: string;
  ref?: string;
  unitIds?: string[];
}): FanOutWorkspaceSet {
  const baseRevision = resolveBaseRevision(
    options.hostRepoRoot,
    options.ref ?? "HEAD",
  );
  const unitIds = options.unitIds ?? ["A", "B"];
  const children: Record<string, Workspace> = {};
  for (const id of unitIds) {
    children[id] = createWorkspace({
      hostRepoRoot: options.hostRepoRoot,
      id: `${options.runId}-child-${id}`,
      ref: baseRevision,
    });
  }
  const integration = createWorkspace({
    hostRepoRoot: options.hostRepoRoot,
    id: `${options.runId}-integration`,
    ref: baseRevision,
  });
  assertExactBaseProvenance({ baseRevision, children, integration });
  return { baseRevision, children, integration };
}

export function cleanupFanOutWorkspaces(
  hostRepoRoot: string,
  workspaces: FanOutWorkspaceSet | Workspace[],
): void {
  const list = Array.isArray(workspaces)
    ? workspaces
    : [...Object.values(workspaces.children), workspaces.integration];
  for (const workspace of list) {
    cleanupWorkspace({ hostRepoRoot, workspace });
  }
}

export function assertExactBaseProvenance(options: {
  baseRevision: string;
  children: Record<string, Workspace>;
  integration: Workspace;
}): FanOutProvenance {
  const childRevisions: Record<string, string> = {};
  const mismatches: string[] = [];
  for (const [id, workspace] of Object.entries(options.children)) {
    const head = readWorkspaceHead(workspace.root);
    childRevisions[id] = workspace.baseRevision;
    if (workspace.baseRevision !== options.baseRevision) {
      mismatches.push(
        `child ${id} baseRevision ${workspace.baseRevision} != ${options.baseRevision}`,
      );
    }
    if (head !== options.baseRevision) {
      mismatches.push(`child ${id} HEAD ${head} != ${options.baseRevision}`);
    }
  }
  const integrationHead = readWorkspaceHead(options.integration.root);
  if (options.integration.baseRevision !== options.baseRevision) {
    mismatches.push(
      `integration baseRevision ${options.integration.baseRevision} != ${options.baseRevision}`,
    );
  }
  if (integrationHead !== options.baseRevision) {
    mismatches.push(
      `integration HEAD ${integrationHead} != ${options.baseRevision}`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Fan-out workspaces do not share exact baseRevision: ${mismatches.join("; ")}`,
    );
  }
  return {
    baseRevision: options.baseRevision,
    childRevisions,
    integrationRevision: options.integration.baseRevision,
    exactBase: true,
  };
}

export async function scheduleFanOutChildren<T>(options: {
  units: FanOutUnit[];
  schedule: FanOutSchedule;
  runChild: (unit: FanOutUnit) => Promise<T>;
}): Promise<Array<PromiseSettledResult<T>>> {
  if (options.schedule === "sequential") {
    const results: Array<PromiseSettledResult<T>> = [];
    for (const unit of options.units) {
      results.push(await settleChild(() => options.runChild(unit)));
    }
    return results;
  }

  return Promise.all(
    options.units.map((unit) => settleChild(() => options.runChild(unit))),
  );
}

export function fanInChildDeltas(options: {
  plan: FanOutPlan;
  integration: Workspace;
  children: ChildArtifact[];
}): FanInReport {
  const started = Date.now();
  const integrationHead = readWorkspaceHead(options.integration.root);
  if (integrationHead !== options.plan.baseRevision) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      appliedUnitIds: [],
      conflict: {
        failedUnitId: options.plan.integrationOrder[0] ?? "(none)",
        evidence: `integration HEAD ${integrationHead} != plan.baseRevision ${options.plan.baseRevision}`,
        appliedUnitIds: [],
      },
      lostChanges: [],
      integrationChangedFiles: [],
    };
  }

  const byId = new Map(options.children.map((item) => [item.unitId, item]));
  const appliedUnitIds: string[] = [];
  for (const unit of unitsInIntegrationOrder(options.plan)) {
    const child = byId.get(unit.id);
    if (!child) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        appliedUnitIds,
        conflict: {
          failedUnitId: unit.id,
          evidence: `missing child artifact for unit ${unit.id}`,
          appliedUnitIds,
        },
        lostChanges: [],
        integrationChangedFiles: listUncommittedSourceFiles(
          options.integration.root,
        ),
      };
    }
    if (child.baseRevision !== options.plan.baseRevision) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        appliedUnitIds,
        conflict: {
          failedUnitId: unit.id,
          evidence: `child ${unit.id} baseRevision ${child.baseRevision} != plan.baseRevision ${options.plan.baseRevision}`,
          appliedUnitIds,
        },
        lostChanges: [],
        integrationChangedFiles: listUncommittedSourceFiles(
          options.integration.root,
        ),
      };
    }
    if (!child.verificationPassed) {
      return {
        ok: false,
        durationMs: Date.now() - started,
        appliedUnitIds,
        conflict: {
          failedUnitId: unit.id,
          evidence: `child ${unit.id} scoped VERIFY did not pass`,
          appliedUnitIds,
        },
        lostChanges: [],
        integrationChangedFiles: listUncommittedSourceFiles(
          options.integration.root,
        ),
      };
    }
    const applied = applySourceDelta({
      workspaceRoot: options.integration.root,
      baseRevision: options.plan.baseRevision,
      delta: child.sourceDelta,
    });
    if (!applied.ok) {
      unstageWithoutLosingWork(options.integration.root);
      return {
        ok: false,
        durationMs: Date.now() - started,
        appliedUnitIds,
        conflict: {
          failedUnitId: unit.id,
          evidence: applied.evidence,
          appliedUnitIds,
        },
        lostChanges: [],
        integrationChangedFiles: applied.changedFiles,
      };
    }
    appliedUnitIds.push(unit.id);
  }

  unstageWithoutLosingWork(options.integration.root);
  const integrationChangedFiles = listUncommittedSourceFiles(
    options.integration.root,
  );
  const overlap = writeSetOverlap(options.children);
  const lostChanges = detectLostChanges({
    children: options.children,
    overlap,
    integrationRoot: options.integration.root,
    integrationChangedFiles,
  });
  return {
    ok: lostChanges.length === 0,
    durationMs: Date.now() - started,
    appliedUnitIds,
    conflict: null,
    lostChanges,
    integrationChangedFiles,
  };
}

export function writeSetOverlap(children: ChildArtifact[]): string[] {
  if (children.length < 2) {
    return [];
  }
  const [first, ...rest] = children;
  return first.changedFiles
    .filter((file) => rest.every((child) => child.changedFiles.includes(file)))
    .sort();
}

export function childExecutionInterval(children: ChildArtifact[]): number {
  if (children.length === 0) {
    return 0;
  }
  const started = Math.min(...children.map((item) => item.startedAt));
  const finished = Math.max(...children.map((item) => item.finishedAt));
  return Math.max(0, finished - started);
}

function detectLostChanges(options: {
  children: ChildArtifact[];
  overlap: string[];
  integrationRoot: string;
  integrationChangedFiles: string[];
}): string[] {
  const lost: string[] = [];
  const overlap = new Set(options.overlap);
  for (const child of options.children) {
    for (const file of child.changedFiles) {
      if (overlap.has(file)) {
        continue;
      }
      if (!options.integrationChangedFiles.includes(file)) {
        lost.push(`${child.unitId}:${file}`);
        continue;
      }
      const childPath = path.join(child.workspaceRoot, file);
      const integrationPath = path.join(options.integrationRoot, file);
      if (!sameFileContents(childPath, integrationPath)) {
        lost.push(`${child.unitId}:${file}`);
      }
    }
  }
  return lost;
}

function childArtifactFromEpisode(options: {
  unitId: string;
  workspaceRoot: string;
  baseRevision: string;
  episode: ChildEpisodeResult;
  sourceDelta: SourceDelta;
  reviewDiff: string;
}): ChildArtifact {
  return {
    unitId: options.unitId,
    workspaceRoot: options.workspaceRoot,
    baseRevision: options.baseRevision,
    changedFiles: options.sourceDelta.changedFiles,
    sourceDelta: options.sourceDelta,
    reviewDiff: options.reviewDiff,
    verificationPassed: options.episode.verificationPassed,
    verificationOutput: options.episode.verificationOutput,
    repairAttempts: options.episode.repairAttempts,
    durationMs: options.episode.finishedAt - options.episode.startedAt,
    modelCalls: options.episode.episode.modelCalls,
    toolCalls: options.episode.episode.toolCalls,
    tokenUsage: options.episode.episode.tokenUsage,
    startedAt: options.episode.startedAt,
    finishedAt: options.episode.finishedAt,
  };
}

function createChildWorkspaces(options: {
  hostRepoRoot: string;
  runId: string;
  baseRevision: string;
  unitIds: string[];
  owned: Workspace[];
}): Record<string, Workspace> {
  const children: Record<string, Workspace> = {};
  for (const id of options.unitIds) {
    const workspace = createWorkspace({
      hostRepoRoot: options.hostRepoRoot,
      id: `${options.runId}-child-${id}`,
      ref: options.baseRevision,
    });
    options.owned.push(workspace);
    children[id] = workspace;
  }
  return children;
}

function requireChildWorkspace(
  children: Record<string, Workspace>,
  unitId: string,
): Workspace {
  const workspace = children[unitId];
  if (!workspace) {
    throw new Error(`Missing child workspace for unit ${unitId}`);
  }
  return workspace;
}

async function settleChild<T>(
  run: () => Promise<T>,
): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await run() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function mergeEpisodes(episodes: AgentRunResult[]): AgentRunResult | null {
  if (episodes.length === 0) {
    return null;
  }
  return episodes.slice(1).reduce(mergeAgentRuns, episodes[0]);
}

function mergeAgentRuns(
  left: AgentRunResult,
  right: AgentRunResult,
): AgentRunResult {
  return {
    ...right,
    turns: left.turns + right.turns,
    modelCalls: left.modelCalls + right.modelCalls,
    toolCalls: left.toolCalls + right.toolCalls,
    receivedTerminalResponse: right.receivedTerminalResponse,
    durationMs: left.durationMs + right.durationMs,
    discovery: {
      listFilesCalls:
        left.discovery.listFilesCalls + right.discovery.listFilesCalls,
      readFileCalls:
        left.discovery.readFileCalls + right.discovery.readFileCalls,
      readFilePaths: uniquePaths(
        left.discovery.readFilePaths,
        right.discovery.readFilePaths,
      ),
      listedPaths: uniquePaths(
        left.discovery.listedPaths,
        right.discovery.listedPaths,
      ),
    },
    implNavCallsBeforeFirstWrite:
      left.implNavCallsBeforeFirstWrite ?? right.implNavCallsBeforeFirstWrite,
    tokenUsage: combineTokenUsage(left.tokenUsage, right.tokenUsage),
    clientInputItemsSent:
      left.clientInputItemsSent + right.clientInputItemsSent,
    clientInputBytesSent:
      left.clientInputBytesSent + right.clientInputBytesSent,
    researchDelegations: [
      ...left.researchDelegations,
      ...right.researchDelegations,
    ],
  };
}

function uniquePaths(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}

function sameFileContents(left: string, right: string): boolean {
  const leftExists = fs.existsSync(left);
  const rightExists = fs.existsSync(right);
  if (!leftExists && !rightExists) {
    return true;
  }
  if (leftExists !== rightExists) {
    return false;
  }
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}
