import path from "node:path";
import { resolveWithin } from "../paths.ts";

export type ImpactFinding = {
  path: string;
  observation: string;
};

export type ImpactAnalysisArtifact = {
  objective: string;
  relevantPaths: string[];
  findings: ImpactFinding[];
};

const MAX_FINDINGS = 8;
const MAX_PATHS = 12;
const MAX_OBSERVATION_CHARS = 240;

export function admitImpactArtifact(
  value: unknown,
  options: { allowedRoot: string; scope: string },
): { ok: true; value: ImpactAnalysisArtifact } | { ok: false; reason: string } {
  if (!isRecord(value)) {
    return { ok: false, reason: "artifact_not_object" };
  }
  if (typeof value.objective !== "string" || value.objective.trim() === "") {
    return { ok: false, reason: "objective_missing" };
  }
  if (!Array.isArray(value.relevantPaths) || !Array.isArray(value.findings)) {
    return { ok: false, reason: "required_fields_missing" };
  }
  if (value.relevantPaths.length === 0 || value.findings.length === 0) {
    return { ok: false, reason: "required_fields_missing" };
  }

  const relevantPaths: string[] = [];
  for (const entry of value.relevantPaths) {
    const admitted = admitPath(entry, options);
    if (!admitted.ok) {
      return admitted;
    }
    relevantPaths.push(admitted.path);
  }

  const findings: ImpactFinding[] = [];
  for (const entry of value.findings) {
    if (!isRecord(entry)) {
      return { ok: false, reason: "finding_not_object" };
    }
    const admitted = admitPath(entry.path, options);
    if (!admitted.ok) {
      return admitted;
    }
    if (
      typeof entry.observation !== "string" ||
      entry.observation.trim() === ""
    ) {
      return { ok: false, reason: "observation_missing" };
    }
    findings.push({
      path: admitted.path,
      observation: entry.observation.trim().slice(0, MAX_OBSERVATION_CHARS),
    });
  }

  return {
    ok: true,
    value: {
      objective: value.objective.trim(),
      relevantPaths: relevantPaths.slice(0, MAX_PATHS),
      findings: findings.slice(0, MAX_FINDINGS),
    },
  };
}

export function formatImpactEvidence(
  artifact: ImpactAnalysisArtifact,
  hostObjective: string,
): string {
  const findings = artifact.findings
    .map((finding) => `- ${finding.path}: ${finding.observation}`)
    .join("\n");
  return [
    "Remote impact analysis (advisory evidence only).",
    "This does not change WorkflowState, VERIFY, REVIEW, or workflow success.",
    `Objective: ${hostObjective.trim()}`,
    `Relevant paths: ${artifact.relevantPaths.join(", ")}`,
    findings,
  ].join("\n");
}

export function scopeCeiling(allowedRoot: string, scope: string): string {
  const normalized = scope.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "" || normalized === "." || /\s/.test(normalized)) {
    return path.resolve(allowedRoot);
  }
  try {
    return resolveWithin(allowedRoot, normalized);
  } catch {
    return path.resolve(allowedRoot);
  }
}

function admitPath(
  value: unknown,
  options: { allowedRoot: string; scope: string },
): { ok: true; path: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, reason: "path_missing" };
  }
  const relativePath = value.trim().replace(/\\/g, "/");
  let resolved: string;
  try {
    resolved = resolveWithin(options.allowedRoot, relativePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `path_outside_scope: ${message}` };
  }
  const ceiling = scopeCeiling(options.allowedRoot, options.scope);
  const prefix = ceiling.endsWith(path.sep) ? ceiling : `${ceiling}${path.sep}`;
  if (resolved !== ceiling && !resolved.startsWith(prefix)) {
    return {
      ok: false,
      reason: `path_outside_scope: ${relativePath}`,
    };
  }
  return { ok: true, path: relativePath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
