import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadConfig } from "./config.ts";
import { droppedChildEvidencePaths } from "./investigation-report.ts";
import {
  evaluateSwm01LiveMechanism,
  pathReadMetrics,
  runBaselineInvestigation,
  runMultiAgentInvestigation,
  workerCoverageOverlap,
  type BaselineInvestigationResult,
  type MultiAgentInvestigationResult,
} from "./investigation-swarm.ts";
import { gradeInvestigationReport, type Swm01Grade } from "./swm01-grader.ts";
import { SWM01_OBJECTIVE } from "./swm01-contract.ts";
import {
  bindConfig,
  cleanupWorkspace,
  createWorkspace,
  resolveBaseRevision,
} from "./workspace.ts";

export async function runSwm01Probe(): Promise<void> {
  const config = loadConfig();
  const baseRevision = resolveBaseRevision(REPO_ROOT, "HEAD");
  const workspace = createWorkspace({
    hostRepoRoot: REPO_ROOT,
    id: `swm01-${traceStamp()}`,
    ref: baseRevision,
  });
  const bound = bindConfig(config, workspace);
  const createdStatus = workspaceStatus(workspace.root);
  let baseline: BaselineInvestigationResult | null = null;
  let variant: MultiAgentInvestigationResult | null = null;
  try {
    baseline = await runBaselineInvestigation({
      config: bound,
      objective: SWM01_OBJECTIVE,
    });
    variant = await runMultiAgentInvestigation({
      config: bound,
      objective: SWM01_OBJECTIVE,
    });
    const baselineGrade = baseline.report
      ? gradeInvestigationReport(baseline.report, workspace.root)
      : null;
    const variantGrade = variant.report
      ? gradeInvestigationReport(variant.report, workspace.root)
      : null;
    const droppedPaths = variant.report
      ? droppedChildEvidencePaths(variant.children, variant.report)
      : [];
    const mechanism = evaluateSwm01LiveMechanism(variant);
    const mutations = workspaceMutationsSince(
      createdStatus,
      workspaceStatus(workspace.root),
    );
    const validPair = baseline.report !== null && variant.report !== null && variant.admission.ok;
    const mechanismPass =
      validPair &&
      baseline.model === variant.model &&
      Object.values(mechanism).every(Boolean) &&
      mutations.length === 0;
    const evidence = {
      baseRevision,
      model: config.model,
      objective: SWM01_OBJECTIVE,
      workspaceRoot: workspace.root,
      workspaceDirty: mutations.join("\n"),
      validPair,
      mechanismPass,
      mechanism,
      droppedChildEvidencePaths: droppedPaths,
      baseline: armEvidence(baseline, baselineGrade),
      variant: {
        ...armEvidence(variant, variantGrade),
        workerCount: variant.children.length,
        workerObjectives: variant.children.map((child) => ({
          id: child.id,
          objective: child.objective,
          scopeHint: child.scopeHint,
        })),
        children: variant.children.map((child) => ({
          id: child.id,
          status: child.status,
          failureReason: child.failureReason,
          startedAt: child.startedAt,
          finishedAt: child.finishedAt,
          durationMs: child.durationMs,
          reportBytes: child.reportBytes,
          modelCalls: child.modelCalls,
          toolCalls: child.toolCalls,
          inputTokens: child.inputTokens,
          outputTokens: child.outputTokens,
          pathsRead: child.pathsRead,
        })),
        overlap: variant.overlap,
        childFailures: variant.children
          .filter((child) => child.status === "failure")
          .map((child) => ({ id: child.id, reason: child.failureReason })),
        synthesisInputBytes: variant.synthesisInput?.length ?? 0,
        coverageOverlap: workerCoverageOverlap(variant.children),
        leadPlan: pathReadMetrics(variant.leadPlanUsage.pathsRead),
        synthesis: {
          modelCalls: variant.synthesisUsage.modelCalls,
          toolCalls: variant.synthesisUsage.toolCalls,
          inputTokens: variant.synthesisUsage.inputTokens,
          outputTokens: variant.synthesisUsage.outputTokens,
        },
      },
      reports: {
        baseline: baseline.report,
        variant: variant.report,
        children: variant.children.map((child) => ({
          id: child.id,
          report: child.report,
        })),
      },
    };
    const reportPath = writeEvidence(evidence);
    console.log(formatSummary(evidence, reportPath));
    process.exit(mechanismPass ? 0 : 1);
  } finally {
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
  }
}

function armEvidence(
  result: BaselineInvestigationResult | MultiAgentInvestigationResult,
  grade: Swm01Grade | null,
) {
  const paths = pathReadMetrics(result.usage.pathsRead);
  return {
    ok: result.ok,
    failureReason: result.failureReason,
    wallMs: result.wallMs,
    modelCalls: result.usage.modelCalls,
    toolCalls: result.usage.toolCalls,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    pathsRead: paths.pathsRead,
    uniquePathsRead: paths.uniquePathsRead,
    duplicatePathReads: paths.duplicatePathReads,
    grade,
  };
}

function formatSummary(evidence: {
  baseRevision: string;
  model: string;
  validPair: boolean;
  mechanismPass: boolean;
  workspaceDirty: string;
  mechanism: Record<string, boolean>;
  droppedChildEvidencePaths: unknown[];
  baseline: ReturnType<typeof armEvidence>;
  variant: ReturnType<typeof armEvidence> & {
    workerCount: number;
    overlap: MultiAgentInvestigationResult["overlap"];
    coverageOverlap: string[];
    childFailures: Array<{ id: string; reason: string | null }>;
    synthesisInputBytes: number;
  };
}, reportPath: string): string {
  const lines = [
    "SWM01 bounded paired probe",
    `base_revision: ${evidence.baseRevision}`,
    `model: ${evidence.model}`,
    `valid_pair: ${evidence.validPair}`,
    `mechanism_pass: ${evidence.mechanismPass}`,
    `workspace_dirty: ${evidence.workspaceDirty === "" ? "no" : evidence.workspaceDirty}`,
    `baseline_wall_ms: ${evidence.baseline.wallMs}`,
    `baseline_model_calls: ${evidence.baseline.modelCalls}`,
    `baseline_tool_calls: ${evidence.baseline.toolCalls}`,
    `baseline_input_tokens: ${evidence.baseline.inputTokens}`,
    `baseline_output_tokens: ${evidence.baseline.outputTokens}`,
    `baseline_unique_paths: ${evidence.baseline.uniquePathsRead.length}`,
    `baseline_duplicate_paths: ${evidence.baseline.duplicatePathReads.length}`,
    `baseline_coverage: ${evidence.baseline.grade?.coverageRatio ?? "invalid"}`,
    `baseline_correctness: ${evidence.baseline.grade?.correctnessRatio ?? "invalid"}`,
    `baseline_incorrect: ${evidence.baseline.grade?.incorrectClaims.length ?? "invalid"}`,
    `baseline_unsupported: ${evidence.baseline.grade?.unsupportedFindings.length ?? "invalid"}`,
    `variant_wall_ms: ${evidence.variant.wallMs}`,
    `variant_model_calls: ${evidence.variant.modelCalls}`,
    `variant_tool_calls: ${evidence.variant.toolCalls}`,
    `variant_input_tokens: ${evidence.variant.inputTokens}`,
    `variant_output_tokens: ${evidence.variant.outputTokens}`,
    `variant_unique_paths: ${evidence.variant.uniquePathsRead.length}`,
    `variant_duplicate_paths: ${evidence.variant.duplicatePathReads.length}`,
    `variant_coverage: ${evidence.variant.grade?.coverageRatio ?? "invalid"}`,
    `variant_correctness: ${evidence.variant.grade?.correctnessRatio ?? "invalid"}`,
    `variant_incorrect: ${evidence.variant.grade?.incorrectClaims.length ?? "invalid"}`,
    `variant_unsupported: ${evidence.variant.grade?.unsupportedFindings.length ?? "invalid"}`,
    `workers: ${evidence.variant.workerCount}`,
    `overlap: ${evidence.variant.overlap?.overlapped === true}`,
    `child_failures: ${evidence.variant.childFailures.length}`,
    `synthesis_input_bytes: ${evidence.variant.synthesisInputBytes}`,
    `worker_path_overlap: ${evidence.variant.coverageOverlap.length}`,
    `dropped_child_evidence_paths: ${evidence.droppedChildEvidencePaths.length}`,
    `report: ${reportPath}`,
  ];
  return lines.join("\n");
}

function writeEvidence(evidence: unknown): string {
  const id = traceStamp();
  const dir = path.join(REPO_ROOT, "docs/learning/lessons/26-bounded-multi-agent/traces");
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `swm01-${id}.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return jsonPath;
}

export function workspaceMutationsSince(
  createdStatus: string,
  currentStatus: string,
): string[] {
  const created = new Set(porcelainLines(createdStatus));
  return porcelainLines(currentStatus).filter((line) => !created.has(line));
}

function porcelainLines(status: string): string[] {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function workspaceStatus(repoRoot: string): string {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return (result.stdout ?? "").trim();
}

function traceStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isDirectRun(argv: string[]): boolean {
  return argv.some((arg) => arg.includes("swm01-probe.ts"));
}

if (isDirectRun(process.argv)) {
  runSwm01Probe().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
