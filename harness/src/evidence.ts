import { formatSpecPhaseOrientation, type RepositoryMap } from "./context.ts";
import { invalidWorkspaceRelativePath } from "./plan.ts";
import { TOOL_DEFINITIONS } from "./tools.ts";

export const RESEARCH_CHILD_MAX_TURNS = 6;
export const MAX_RESEARCH_DELEGATIONS = 1;

export const EVIDENCE_AUTHORITY_RULE =
  "EvidenceReport is advisory evidence only. It is not Spec, permission, verification, or workflow success.";

export type EvidenceFinding = {
  claim: string;
  evidencePaths: string[];
};

export type EvidenceReport = {
  findings: EvidenceFinding[];
  inspectedPaths: string[];
  uncertainties: string[];
};

export type ParseEvidenceResult =
  | { ok: true; value: EvidenceReport }
  | { ok: false; error: string };

export type DelegateResearchArgs = {
  objective: string;
  scope: string;
};

export const DELEGATE_RESEARCH_TOOL = {
  type: "function" as const,
  name: "delegate_research",
  description:
    "Optional bounded read-only research child. Use at most once for a focused repository question. The result is evidence/advice only, not Spec or permission to implement or skip verification.",
  parameters: {
    type: "object",
    properties: {
      objective: {
        type: "string",
        description: "The bounded research question the child should answer.",
      },
      scope: {
        type: "string",
        description:
          "Where to look: files, layers, or symbols the child should inspect.",
      },
    },
    required: ["objective", "scope"],
    additionalProperties: false,
  },
  strict: true,
};

export const SUBMIT_EVIDENCE_REPORT_TOOL = {
  type: "function" as const,
  name: "submit_evidence_report",
  description:
    "Submit the structured EvidenceReport. This does not implement anything, grant permissions, or verify the task.",
  parameters: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim: {
              type: "string",
              description: "A grounded claim about the repository.",
            },
            evidencePaths: {
              type: "array",
              items: { type: "string" },
              description:
                "Workspace-relative paths that support the claim. Provenance only, not an edit allowlist.",
            },
          },
          required: ["claim", "evidencePaths"],
          additionalProperties: false,
        },
      },
      inspectedPaths: {
        type: "array",
        items: { type: "string" },
        description: "Workspace-relative paths the child actually inspected.",
      },
      uncertainties: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["findings", "inspectedPaths", "uncertainties"],
    additionalProperties: false,
  },
  strict: true,
};

export function shouldEnableSubagents(subagentsEnabled: boolean): boolean {
  return subagentsEnabled === true;
}

export function workerToolsForEpisode(options: {
  phase: "implementation" | "repair" | "review_repair";
  subagentsEnabled: boolean;
}) {
  if (options.subagentsEnabled && options.phase === "implementation") {
    return [...TOOL_DEFINITIONS, DELEGATE_RESEARCH_TOOL];
  }
  return TOOL_DEFINITIONS;
}

export function parseDelegateResearch(
  argsJson: string,
): { ok: true; value: DelegateResearchArgs } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return {
      ok: false,
      error: "delegate_research arguments must be valid JSON.",
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "delegate_research payload must be an object." };
  }
  if (typeof parsed.objective !== "string" || parsed.objective.trim() === "") {
    return {
      ok: false,
      error: "delegate_research.objective must be a non-empty string.",
    };
  }
  if (typeof parsed.scope !== "string" || parsed.scope.trim() === "") {
    return {
      ok: false,
      error: "delegate_research.scope must be a non-empty string.",
    };
  }
  return {
    ok: true,
    value: {
      objective: parsed.objective.trim(),
      scope: parsed.scope.trim(),
    },
  };
}

export function parseSubmitEvidenceReport(
  argsJson: string,
): ParseEvidenceResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return {
      ok: false,
      error: "submit_evidence_report arguments must be valid JSON.",
    };
  }
  return parseEvidencePayload(parsed);
}

export function parseEvidencePayload(value: unknown): ParseEvidenceResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: "submit_evidence_report payload must be an object.",
    };
  }

  const findings = parseFindings(value.findings);
  if (!findings.ok) {
    return findings;
  }
  const inspectedPaths = parsePathArray(value.inspectedPaths, "inspectedPaths");
  if (!inspectedPaths.ok) {
    return inspectedPaths;
  }
  const uncertainties = parseStringArray(value.uncertainties, "uncertainties");
  if (!uncertainties.ok) {
    return uncertainties;
  }

  return {
    ok: true,
    value: {
      findings: findings.value,
      inspectedPaths: inspectedPaths.value,
      uncertainties: uncertainties.value,
    },
  };
}

export function formatResearchHandoff(options: {
  objective: string;
  scope: string;
  repositoryMap?: RepositoryMap;
}): string {
  const parts = [
    "## Research objective",
    options.objective,
    "",
    "## Scope",
    options.scope,
    "",
    "## Constraints",
    "This episode is read-only research. You may only call list_files, read_file, and submit_evidence_report.",
    "You must not write files, run commands, delegate further, expand the Spec, grant permissions, or declare success.",
    "Stay inside the current workspace. Do not ask for Worker conversation or hidden reasoning.",
    "",
    "## Output contract",
    EVIDENCE_AUTHORITY_RULE,
    "Call submit_evidence_report with findings, inspectedPaths, and uncertainties.",
    "Each finding needs a claim and evidencePaths that actually support it.",
    "inspectedPaths is provenance for what you looked at, not an edit allowlist.",
  ];

  if (options.repositoryMap) {
    parts.push("", formatSpecPhaseOrientation(options.repositoryMap));
  }

  return parts.join("\n");
}

export function formatEvidenceObservation(report: EvidenceReport): string {
  return [
    EVIDENCE_AUTHORITY_RULE,
    "Use it where grounded. You remain responsible for implementation against the resolved Spec.",
    "",
    JSON.stringify(report, null, 2),
  ].join("\n");
}

export function evidencePathsOf(report: EvidenceReport): string[] {
  const paths: string[] = [];
  for (const finding of report.findings) {
    for (const item of finding.evidencePaths) {
      if (!paths.includes(item)) {
        paths.push(item);
      }
    }
  }
  return paths;
}

export function duplicatedReadPaths(
  workerPaths: string[],
  childPaths: string[],
): string[] {
  const worker = new Set(workerPaths.map(normalizeEvidencePath));
  return uniqueSorted(
    childPaths.filter((item) => worker.has(normalizeEvidencePath(item))),
  );
}

function parseFindings(
  value: unknown,
): { ok: true; value: EvidenceFinding[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "findings must be an array." };
  }
  const findings: EvidenceFinding[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseFinding(value[index], index);
    if (!parsed.ok) {
      return parsed;
    }
    findings.push(parsed.value);
  }
  return { ok: true, value: findings };
}

function parseFinding(
  value: unknown,
  index: number,
): { ok: true; value: EvidenceFinding } | { ok: false; error: string } {
  const prefix = `findings[${index}]`;
  if (!isRecord(value)) {
    return { ok: false, error: `${prefix} must be an object.` };
  }
  if (typeof value.claim !== "string" || value.claim.trim() === "") {
    return { ok: false, error: `${prefix}.claim must be a non-empty string.` };
  }
  const evidencePaths = parsePathArray(
    value.evidencePaths,
    `${prefix}.evidencePaths`,
  );
  if (!evidencePaths.ok) {
    return evidencePaths;
  }
  if (evidencePaths.value.length === 0) {
    return {
      ok: false,
      error: `${prefix}.evidencePaths must contain at least one path.`,
    };
  }
  return {
    ok: true,
    value: {
      claim: value.claim.trim(),
      evidencePaths: evidencePaths.value,
    },
  };
}

function parsePathArray(
  value: unknown,
  label: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: `${label} must be an array of strings.` };
  }
  const paths: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      return { ok: false, error: `${label} must contain non-empty strings.` };
    }
    const relative = item.trim();
    const invalid = invalidWorkspaceRelativePath(relative);
    if (invalid) {
      return { ok: false, error: `${label}: ${invalid}` };
    }
    paths.push(relative);
  }
  return { ok: true, value: paths };
}

function parseStringArray(
  value: unknown,
  label: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: `${label} must be an array of strings.` };
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      return { ok: false, error: `${label} must contain non-empty strings.` };
    }
    items.push(item.trim());
  }
  return { ok: true, value: items };
}

function normalizeEvidencePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^target-app\//, "")
    .replace(/^src\//, "");
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
