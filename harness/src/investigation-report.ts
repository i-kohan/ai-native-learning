import { invalidWorkspaceRelativePath } from "./plan.ts";

export type InvestigationDurableSupport =
  | "supported"
  | "unsupported"
  | "partial"
  | "unknown";

export type InvestigationDefaultStatus = "default" | "opt-in" | "conditional";

export type InvestigationMechanism = {
  name: string;
  entryPoints: string[];
  activationOwner: string;
  capabilities: string[];
  evidence: string[];
  retainedOuterAuthority: string[];
  durableSupport: InvestigationDurableSupport;
  defaultStatus: InvestigationDefaultStatus;
  evidencePaths: string[];
};

export type InvestigationUncertainty = {
  claim: string;
  reason: string;
};

export type InvestigationReport = {
  mechanisms: InvestigationMechanism[];
  uncertainties: InvestigationUncertainty[];
  coverageSummary: string;
};

export type ChildFinding = {
  claim: string;
  evidencePaths: string[];
};

export type ChildInvestigationReport = {
  objective: string;
  findings: ChildFinding[];
  uncertainties: string[];
};

export type ReportParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const DURABLE: readonly InvestigationDurableSupport[] = [
  "supported",
  "unsupported",
  "partial",
  "unknown",
];

const DEFAULT_STATUS: readonly InvestigationDefaultStatus[] = [
  "default",
  "opt-in",
  "conditional",
];

export function parseChildInvestigationReport(
  value: unknown,
): ReportParseResult<ChildInvestigationReport> {
  if (!isRecord(value)) {
    return { ok: false, error: "ChildInvestigationReport must be an object." };
  }
  const findings = parseFindings(value.findings);
  if (!findings.ok) {
    return findings;
  }
  const uncertainties = parseStringArray(value.uncertainties, "uncertainties");
  if (!uncertainties.ok) {
    return uncertainties;
  }
  return {
    ok: true,
    value: {
      objective: "",
      findings: findings.value,
      uncertainties: uncertainties.value,
    },
  };
}

export function admitChildInvestigationReport(options: {
  value: unknown;
  objective: string;
  observedReadPaths: string[];
}): ReportParseResult<ChildInvestigationReport> {
  const parsed = parseChildInvestigationReport(options.value);
  if (!parsed.ok) {
    return parsed;
  }
  const observed = new Set(options.observedReadPaths.map(normalizeRepoPath));
  for (let index = 0; index < parsed.value.findings.length; index += 1) {
    for (const cited of parsed.value.findings[index].evidencePaths) {
      if (!observed.has(normalizeRepoPath(cited))) {
        return {
          ok: false,
          error: `findings[${index}].evidencePaths cites a path that was not read: ${cited}`,
        };
      }
    }
  }
  return {
    ok: true,
    value: {
      ...parsed.value,
      objective: options.objective,
    },
  };
}

export function parseInvestigationReport(
  value: unknown,
): ReportParseResult<InvestigationReport> {
  if (!isRecord(value)) {
    return { ok: false, error: "InvestigationReport must be an object." };
  }
  if (!Array.isArray(value.mechanisms)) {
    return { ok: false, error: "mechanisms must be an array." };
  }
  const mechanisms: InvestigationMechanism[] = [];
  for (let index = 0; index < value.mechanisms.length; index += 1) {
    const parsed = parseMechanism(value.mechanisms[index], index);
    if (!parsed.ok) {
      return parsed;
    }
    mechanisms.push(parsed.value);
  }
  const uncertainties = parseUncertainties(value.uncertainties);
  if (!uncertainties.ok) {
    return uncertainties;
  }
  if (
    typeof value.coverageSummary !== "string" ||
    value.coverageSummary.trim() === ""
  ) {
    return { ok: false, error: "coverageSummary must be a non-empty string." };
  }
  return {
    ok: true,
    value: {
      mechanisms,
      uncertainties: uncertainties.value,
      coverageSummary: value.coverageSummary.trim(),
    },
  };
}

export function admitInvestigationReportPaths(
  report: InvestigationReport,
  allowedPaths: string[],
): ReportParseResult<InvestigationReport> {
  const allowed = new Set(allowedPaths.map(normalizeRepoPath));
  for (let index = 0; index < report.mechanisms.length; index += 1) {
    for (const cited of report.mechanisms[index].evidencePaths) {
      if (!allowed.has(normalizeRepoPath(cited))) {
        return {
          ok: false,
          error: `mechanisms[${index}].evidencePaths cites a path outside admitted reads: ${cited}`,
        };
      }
    }
  }
  return { ok: true, value: report };
}

export function enforceIncompleteCoverage(
  report: InvestigationReport,
  failures: Array<{ id: string; reason: string }>,
): InvestigationReport {
  if (failures.length === 0) {
    return report;
  }
  const additions: InvestigationUncertainty[] = [];
  for (const failure of failures) {
    const claim = `Child worker ${failure.id} failed before producing an admitted report.`;
    const already = report.uncertainties.some((item) => item.claim === claim);
    if (!already) {
      additions.push({ claim, reason: failure.reason });
    }
  }
  const marker = "Incomplete coverage:";
  const failedIds = failures.map((failure) => failure.id).join(", ");
  const coverageSummary = report.coverageSummary.includes(marker)
    ? report.coverageSummary
    : `${marker} child workers failed (${failedIds}). ${report.coverageSummary}`;
  return {
    ...report,
    uncertainties: [...report.uncertainties, ...additions],
    coverageSummary,
  };
}

export function lostChildFindings(
  children: Array<{ id: string; report: ChildInvestigationReport | null }>,
  finalReport: InvestigationReport,
): Array<{ workerId: string; claim: string; evidencePaths: string[] }> {
  const kept = new Set(
    finalReport.mechanisms.flatMap((mechanism) =>
      mechanism.evidencePaths.map(normalizeRepoPath),
    ),
  );
  const lost: Array<{
    workerId: string;
    claim: string;
    evidencePaths: string[];
  }> = [];
  for (const child of children) {
    if (!child.report) {
      continue;
    }
    for (const finding of child.report.findings) {
      const preserved = finding.evidencePaths.some((item) =>
        kept.has(normalizeRepoPath(item)),
      );
      if (!preserved) {
        lost.push({
          workerId: child.id,
          claim: finding.claim,
          evidencePaths: finding.evidencePaths,
        });
      }
    }
  }
  return lost;
}

export function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

function parseMechanism(
  value: unknown,
  index: number,
): ReportParseResult<InvestigationMechanism> {
  const prefix = `mechanisms[${index}]`;
  if (!isRecord(value)) {
    return { ok: false, error: `${prefix} must be an object.` };
  }
  if (typeof value.name !== "string" || value.name.trim() === "") {
    return { ok: false, error: `${prefix}.name must be a non-empty string.` };
  }
  if (
    typeof value.activationOwner !== "string" ||
    value.activationOwner.trim() === ""
  ) {
    return {
      ok: false,
      error: `${prefix}.activationOwner must be a non-empty string.`,
    };
  }
  const entryPoints = parseStringArray(
    value.entryPoints,
    `${prefix}.entryPoints`,
  );
  if (!entryPoints.ok) {
    return entryPoints;
  }
  const capabilities = parseStringArray(
    value.capabilities,
    `${prefix}.capabilities`,
  );
  if (!capabilities.ok) {
    return capabilities;
  }
  const evidence = parseStringArray(value.evidence, `${prefix}.evidence`);
  if (!evidence.ok) {
    return evidence;
  }
  const retained = parseStringArray(
    value.retainedOuterAuthority,
    `${prefix}.retainedOuterAuthority`,
  );
  if (!retained.ok) {
    return retained;
  }
  const evidencePaths = parsePathArray(
    value.evidencePaths,
    `${prefix}.evidencePaths`,
  );
  if (!evidencePaths.ok) {
    return evidencePaths;
  }
  if (!isDurable(value.durableSupport)) {
    return {
      ok: false,
      error: `${prefix}.durableSupport must be supported, unsupported, partial, or unknown.`,
    };
  }
  if (!isDefaultStatus(value.defaultStatus)) {
    return {
      ok: false,
      error: `${prefix}.defaultStatus must be default, opt-in, or conditional.`,
    };
  }
  return {
    ok: true,
    value: {
      name: value.name.trim(),
      entryPoints: entryPoints.value,
      activationOwner: value.activationOwner.trim(),
      capabilities: capabilities.value,
      evidence: evidence.value,
      retainedOuterAuthority: retained.value,
      durableSupport: value.durableSupport,
      defaultStatus: value.defaultStatus,
      evidencePaths: evidencePaths.value,
    },
  };
}

function parseFindings(value: unknown): ReportParseResult<ChildFinding[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: "findings must be an array." };
  }
  const findings: ChildFinding[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const prefix = `findings[${index}]`;
    const item = value[index];
    if (!isRecord(item)) {
      return { ok: false, error: `${prefix} must be an object.` };
    }
    if (typeof item.claim !== "string" || item.claim.trim() === "") {
      return {
        ok: false,
        error: `${prefix}.claim must be a non-empty string.`,
      };
    }
    const evidencePaths = parsePathArray(
      item.evidencePaths,
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
    findings.push({
      claim: item.claim.trim(),
      evidencePaths: evidencePaths.value,
    });
  }
  return { ok: true, value: findings };
}

function parseUncertainties(
  value: unknown,
): ReportParseResult<InvestigationUncertainty[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: "uncertainties must be an array." };
  }
  const items: InvestigationUncertainty[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const prefix = `uncertainties[${index}]`;
    const item = value[index];
    if (!isRecord(item)) {
      return { ok: false, error: `${prefix} must be an object.` };
    }
    if (typeof item.claim !== "string" || item.claim.trim() === "") {
      return {
        ok: false,
        error: `${prefix}.claim must be a non-empty string.`,
      };
    }
    if (typeof item.reason !== "string" || item.reason.trim() === "") {
      return {
        ok: false,
        error: `${prefix}.reason must be a non-empty string.`,
      };
    }
    items.push({ claim: item.claim.trim(), reason: item.reason.trim() });
  }
  return { ok: true, value: items };
}

function parseStringArray(
  value: unknown,
  label: string,
): ReportParseResult<string[]> {
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

function parsePathArray(
  value: unknown,
  label: string,
): ReportParseResult<string[]> {
  const parsed = parseStringArray(value, label);
  if (!parsed.ok) {
    return parsed;
  }
  for (const item of parsed.value) {
    const invalid = invalidWorkspaceRelativePath(item);
    if (invalid) {
      return { ok: false, error: `${label}: ${invalid}` };
    }
  }
  return parsed;
}

function isDurable(value: unknown): value is InvestigationDurableSupport {
  return (
    typeof value === "string" &&
    DURABLE.includes(value as InvestigationDurableSupport)
  );
}

function isDefaultStatus(value: unknown): value is InvestigationDefaultStatus {
  return (
    typeof value === "string" &&
    DEFAULT_STATUS.includes(value as InvestigationDefaultStatus)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
