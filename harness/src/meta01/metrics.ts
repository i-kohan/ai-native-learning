import fs from "node:fs";
import path from "node:path";
import { git } from "./git.ts";
import { collectWorktreePatch, coreFunctionsTouched } from "./patch.ts";
import { CANDIDATE_EXISTING_FILE, type CoreLoopFunction } from "./policy.ts";

export type TrialMetric = {
  externalGraderPassed: boolean;
  changedFiles: string[];
  totalChangedLines: number;
  loopChangedLines: number;
  coreFunctionsTouched: CoreLoopFunction[];
  modelCalls: number;
  toolCalls: number;
  wallTimeMs: number;
};

export function measureMaintenanceDiff(workspaceRoot: string): Omit<
  TrialMetric,
  "externalGraderPassed" | "modelCalls" | "toolCalls" | "wallTimeMs"
> {
  const patch = collectWorktreePatch(workspaceRoot);
  const loopStat = patch.perFile.find((item) => item.file === CANDIDATE_EXISTING_FILE);
  const before = git(workspaceRoot, ["show", `HEAD:${CANDIDATE_EXISTING_FILE}`]);
  const loopPath = path.join(workspaceRoot, CANDIDATE_EXISTING_FILE);
  const after = fs.existsSync(loopPath) ? fs.readFileSync(loopPath, "utf8") : "";
  return {
    changedFiles: patch.files,
    totalChangedLines: patch.additions + patch.deletions,
    loopChangedLines: (loopStat?.additions ?? 0) + (loopStat?.deletions ?? 0),
    coreFunctionsTouched: coreFunctionsTouched(before, after),
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}
