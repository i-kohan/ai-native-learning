import { META01_PARENT_REVISION } from "./policy.ts";
import {
  findAuthorityExpansions,
  mutationBoundaryHolds,
  patchWithinBudget,
  type PatchStats,
} from "./patch.ts";

export type IntegrityCheck = {
  id: string;
  passed: boolean;
  evidence: string;
};

export function evaluateIntegrity(input: {
  baseRevision: string;
  changedFiles: string[];
  additions: number;
  deletions: number;
  hypothesisAcceptedBeforeFirstWrite: boolean;
  hasMutation: boolean;
  authorityFindings: string[];
}): { passed: boolean; checks: IntegrityCheck[] } {
  const outside = mutationBoundaryHolds(input.changedFiles);
  const budget = patchWithinBudget({
    files: input.changedFiles,
    additions: input.additions,
    deletions: input.deletions,
  });
  const checks: IntegrityCheck[] = [
    {
      id: "exact_base",
      passed: input.baseRevision === META01_PARENT_REVISION,
      evidence: `baseRevision=${input.baseRevision}`,
    },
    {
      id: "mutation_allowlist",
      passed: outside.length === 0,
      evidence:
        outside.length === 0
          ? input.changedFiles.join(", ") || "(no files)"
          : `outside: ${outside.join(", ")}`,
    },
    {
      id: "patch_budget",
      passed: budget.ok,
      evidence: budget.ok
        ? `${input.additions}+${input.deletions} lines across ${input.changedFiles.length} files`
        : budget.error,
    },
    {
      id: "hypothesis_before_write",
      passed: input.hypothesisAcceptedBeforeFirstWrite,
      evidence: input.hypothesisAcceptedBeforeFirstWrite
        ? "accepted hypothesis precedes the first write"
        : "no accepted hypothesis before the first write",
    },
    {
      id: "forbidden_files_unchanged",
      passed: outside.length === 0,
      evidence:
        outside.length === 0
          ? "benchmark, eval, security, and control-plane paths unchanged"
          : `changed forbidden paths: ${outside.join(", ")}`,
    },
    {
      id: "authority_unchanged",
      passed: input.authorityFindings.length === 0,
      evidence:
        input.authorityFindings.length === 0
          ? "no new process, network, retry, or budget authority in added lines"
          : input.authorityFindings.join(" | "),
    },
    {
      id: "has_mutation",
      passed: input.hasMutation,
      evidence: input.hasMutation ? "candidate patch is non-empty" : "candidate produced no mutation",
    },
  ];
  return { passed: checks.every((check) => check.passed), checks };
}

export function integrityFromPatch(input: {
  baseRevision: string;
  patch: PatchStats & { addedLines: string[] };
  hypothesisAcceptedBeforeFirstWrite: boolean;
}): { passed: boolean; checks: IntegrityCheck[] } {
  return evaluateIntegrity({
    baseRevision: input.baseRevision,
    changedFiles: input.patch.files,
    additions: input.patch.additions,
    deletions: input.patch.deletions,
    hypothesisAcceptedBeforeFirstWrite: input.hypothesisAcceptedBeforeFirstWrite,
    hasMutation: input.patch.files.length > 0,
    authorityFindings: findAuthorityExpansions(input.patch.addedLines),
  });
}
