import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { resolveWithin } from "./paths.ts";
import {
  listMemoryRecords,
  MEMORY_KIND,
  saveMemoryRecord,
  type ImplementationSurfaceClaim,
  type MemoryKind,
  type MemoryRecord,
  type SupportedMemoryEvidence,
} from "./memory-store.ts";

export type {
  ImplementationSurfaceClaim,
  MemoryKind,
  MemoryRecord,
  SupportedMemoryEvidence,
} from "./memory-store.ts";
export { MEMORY_KIND } from "./memory-store.ts";

export type MemoryCandidate = {
  kind: MemoryKind;
  repositoryScope: string;
  claim: ImplementationSurfaceClaim;
  sourcePath: string;
  sourceFingerprint: string;
  baseRevision: string;
  observedAt: string;
  originatingWorkflowId: string;
  originatingRunId: string;
  evidence: SupportedMemoryEvidence;
};

export type MemoryRunOptions = {
  storeDir: string;
  repositoryScope: string;
  promote?: boolean;
  retrieve?: boolean;
};

export type MemoryRunMetrics = {
  memoryCandidates: number;
  memoryAdmitted: number;
  memoryRetrieved: number;
  memoryValidated: number;
  memoryRejectedStale: number;
  memoryInjected: number;
  injectedBytes: number;
  injectedTokensEstimate: number;
};

export type SurfaceObservation = {
  anchor: string;
  sourcePath: string;
  operations: string[];
  statement: string;
  sourceFingerprint: string;
};

export type MemoryValidation = { ok: true } | { ok: false; reason: string };

export type MemoryAdmission =
  | { ok: true; record: MemoryRecord }
  | { ok: false; reason: string };

export type MemoryPromotion = {
  candidate: MemoryCandidate | null;
  record: MemoryRecord | null;
  reason: string | null;
};

export type StaleRejection = {
  id: string;
  reason: string;
};

export type MemoryRetrieval = {
  repositoryScope: string;
  retrievedIds: string[];
  validatedIds: string[];
  rejectedStale: StaleRejection[];
  ignoredOutOfScope: number;
  hint: string | null;
  metrics: MemoryRunMetrics;
};

const ROUTES_RELATIVE = "target-app/src/tasks/task-routes.ts";

export function emptyMemoryMetrics(): MemoryRunMetrics {
  return {
    memoryCandidates: 0,
    memoryAdmitted: 0,
    memoryRetrieved: 0,
    memoryValidated: 0,
    memoryRejectedStale: 0,
    memoryInjected: 0,
    injectedBytes: 0,
    injectedTokensEstimate: 0,
  };
}

export function repositoryScopeOf(repoRoot: string): string {
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const url = result.status === 0 ? result.stdout.trim() : "";
  if (!url) {
    throw new Error(
      "Repository scope cannot be established from git remote origin.",
    );
  }
  return `git:${url}`;
}

export function proposeMemoryCandidate(input: {
  repoRoot: string;
  repositoryScope: string;
  baseRevision: string;
  originatingWorkflowId: string;
  originatingRunId: string;
  observedAt?: string;
  evidence: {
    workflowStatus: string;
    verificationPassed: boolean;
    reviewOutcome: string | null;
  };
}): MemoryCandidate | null {
  if (!supportedEvidence(input.evidence)) {
    return null;
  }
  if (!nonEmpty(input.repositoryScope) || !nonEmpty(input.baseRevision)) {
    return null;
  }
  if (
    !nonEmpty(input.originatingWorkflowId) ||
    !nonEmpty(input.originatingRunId)
  ) {
    return null;
  }
  const observation = observeImplementationSurface(input.repoRoot);
  if (!observation) {
    return null;
  }
  return candidateFromObservation(observation, {
    repositoryScope: input.repositoryScope,
    baseRevision: input.baseRevision,
    originatingWorkflowId: input.originatingWorkflowId,
    originatingRunId: input.originatingRunId,
    observedAt: input.observedAt ?? new Date().toISOString(),
  });
}

export function admitMemory(
  candidate: MemoryCandidate,
  repoRoot: string,
): MemoryAdmission {
  if (!supportedEvidence(candidate.evidence)) {
    return { ok: false, reason: "unsupported_evidence" };
  }
  if (candidate.kind !== MEMORY_KIND) {
    return { ok: false, reason: "unsupported_kind" };
  }
  const observation = observeImplementationSurface(repoRoot);
  if (!observation) {
    return { ok: false, reason: "anchor_missing" };
  }
  if (!candidateMatchesObservation(candidate, observation)) {
    return { ok: false, reason: "claim_mismatch" };
  }
  if (candidate.sourceFingerprint !== observation.sourceFingerprint) {
    return { ok: false, reason: "fingerprint_mismatch" };
  }
  return {
    ok: true,
    record: {
      ...candidate,
      id: memoryId(
        candidate.repositoryScope,
        candidate.sourcePath,
        candidate.claim.anchor,
      ),
      status: "admitted",
    },
  };
}

export function promoteVerifiedMemory(input: {
  storeDir: string;
  repoRoot: string;
  repositoryScope: string;
  baseRevision: string;
  originatingWorkflowId: string;
  originatingRunId: string;
  observedAt?: string;
  evidence: {
    workflowStatus: string;
    verificationPassed: boolean;
    reviewOutcome: string | null;
  };
}): MemoryPromotion {
  const candidate = proposeMemoryCandidate(input);
  if (!candidate) {
    return {
      candidate: null,
      record: null,
      reason: "no_supported_candidate",
    };
  }
  const admitted = admitMemory(candidate, input.repoRoot);
  if (!admitted.ok) {
    return { candidate, record: null, reason: admitted.reason };
  }
  try {
    saveMemoryRecord(input.storeDir, admitted.record);
  } catch (error) {
    return {
      candidate,
      record: null,
      reason: error instanceof Error ? error.message : "persist_failed",
    };
  }
  return { candidate, record: admitted.record, reason: null };
}

export function retrieveWorkerMemory(options: {
  storeDir: string;
  repositoryScope: string;
  repoRoot: string;
}): MemoryRetrieval {
  let records: MemoryRecord[];
  try {
    records = listMemoryRecords(options.storeDir);
  } catch (error) {
    return failedRetrieval(
      options.repositoryScope,
      error instanceof Error ? error.message : "store_unreadable",
    );
  }

  const inScope = records.filter(
    (record) => record.repositoryScope === options.repositoryScope,
  );
  const ignoredOutOfScope = records.length - inScope.length;
  const validated: MemoryRecord[] = [];
  const rejectedStale: StaleRejection[] = [];
  for (const record of inScope) {
    const validation = validateMemoryRecord(record, options.repoRoot);
    if (validation.ok) {
      validated.push(record);
    } else {
      rejectedStale.push({ id: record.id, reason: validation.reason });
    }
  }

  const chosen = validated.length === 1 ? validated[0] : null;
  const hint = chosen ? formatMemoryHint(chosen) : null;
  const injectedBytes = hint ? Buffer.byteLength(hint, "utf8") : 0;
  return {
    repositoryScope: options.repositoryScope,
    retrievedIds: inScope.map((record) => record.id),
    validatedIds: validated.map((record) => record.id),
    rejectedStale,
    ignoredOutOfScope,
    hint,
    metrics: {
      ...emptyMemoryMetrics(),
      memoryRetrieved: inScope.length,
      memoryValidated: validated.length,
      memoryRejectedStale: rejectedStale.length,
      memoryInjected: hint ? 1 : 0,
      injectedBytes,
      injectedTokensEstimate: hint ? Math.ceil(injectedBytes / 4) : 0,
    },
  };
}

export function validateMemoryRecord(
  record: MemoryRecord,
  repoRoot: string,
): MemoryValidation {
  let absolute: string;
  try {
    absolute = resolveWithin(repoRoot, record.sourcePath);
  } catch {
    return { ok: false, reason: "source_unreadable" };
  }
  if (!fs.existsSync(absolute)) {
    return { ok: false, reason: "source_missing" };
  }
  const observation = observeImplementationSurface(repoRoot);
  if (!observation) {
    return { ok: false, reason: "anchor_missing" };
  }
  if (
    observation.anchor !== record.claim.anchor ||
    observation.sourcePath !== record.sourcePath ||
    observation.sourcePath !== record.claim.sourcePath ||
    observation.statement !== record.claim.statement ||
    !sameList(observation.operations, record.claim.operations)
  ) {
    return { ok: false, reason: "claim_mismatch" };
  }
  // Fingerprint stays provenance. A byte change does not falsify the claim.
  return { ok: true };
}

export function formatMemoryHint(record: MemoryRecord): string {
  return [
    "## Repository memory (advisory hint)",
    "Admitted from a prior verified workflow and revalidated against the current repository.",
    "This hint is not authoritative.",
    "The resolved specification remains authoritative for required behavior.",
    "Current repository state remains factual authority.",
    "You may still use list_files and read_file. This hint does not limit inspection to the remembered path.",
    "",
    `Claim: ${record.claim.statement}`,
    `Anchor: ${record.claim.anchor}`,
    `Source: ${record.sourcePath}`,
    `Operations: ${record.claim.operations.join(", ")}`,
  ].join("\n");
}

export function observeImplementationSurface(
  repoRoot: string,
): SurfaceObservation | null {
  let routesSource: string;
  try {
    routesSource = fs.readFileSync(
      resolveWithin(repoRoot, ROUTES_RELATIVE),
      "utf8",
    );
  } catch {
    return null;
  }

  const handler = routesSource.match(
    /export\s+function\s+createTaskRoutes\(\s*service:\s*([A-Za-z0-9_]+)\s*\)/,
  );
  const anchor = handler?.[1];
  if (!anchor) {
    return null;
  }

  const imported = routesSource.match(
    new RegExp(
      `import\\s+(?:type\\s+)?\\{\\s*${anchor}\\s*\\}\\s+from\\s+"(\\./[^"]+)"`,
    ),
  );
  const importedPath = imported?.[1];
  if (!importedPath || importedPath.includes("..")) {
    return null;
  }

  const sourcePath = `target-app/src/tasks/${importedPath.slice(2)}`;
  let serviceAbsolute: string;
  let serviceBytes: Buffer;
  try {
    serviceAbsolute = resolveWithin(repoRoot, sourcePath);
    serviceBytes = fs.readFileSync(serviceAbsolute);
  } catch {
    return null;
  }
  const serviceSource = serviceBytes.toString("utf8");
  if (!new RegExp(`export\\s+class\\s+${anchor}\\b`).test(serviceSource)) {
    return null;
  }

  const operations = [
    ...new Set(
      [...routesSource.matchAll(/service\.([A-Za-z0-9_]+)\s*\(/g)]
        .map((match) => match[1])
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort();
  if (operations.length === 0) {
    return null;
  }
  for (const operation of operations) {
    if (!new RegExp(`^\\s+${operation}\\s*\\(`, "m").test(serviceSource)) {
      return null;
    }
  }

  return {
    anchor,
    sourcePath,
    operations,
    statement: `Core task-domain operations are implemented by ${anchor} in ${sourcePath}`,
    sourceFingerprint: crypto
      .createHash("sha256")
      .update(serviceBytes)
      .digest("hex"),
  };
}

export function memoryId(
  repositoryScope: string,
  sourcePath: string,
  anchor: string,
): string {
  const digest = crypto
    .createHash("sha256")
    .update(
      `${repositoryScope}\0${MEMORY_KIND}\0${sourcePath}\0${anchor}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 16);
  return `mem-${digest}`;
}

function candidateFromObservation(
  observation: SurfaceObservation,
  provenance: {
    repositoryScope: string;
    baseRevision: string;
    originatingWorkflowId: string;
    originatingRunId: string;
    observedAt: string;
  },
): MemoryCandidate {
  return {
    kind: MEMORY_KIND,
    repositoryScope: provenance.repositoryScope,
    claim: {
      statement: observation.statement,
      anchor: observation.anchor,
      sourcePath: observation.sourcePath,
      operations: observation.operations,
    },
    sourcePath: observation.sourcePath,
    sourceFingerprint: observation.sourceFingerprint,
    baseRevision: provenance.baseRevision,
    observedAt: provenance.observedAt,
    originatingWorkflowId: provenance.originatingWorkflowId,
    originatingRunId: provenance.originatingRunId,
    evidence: {
      verificationPassed: true,
      reviewOutcome: "pass",
      workflowStatus: "success",
    },
  };
}

function candidateMatchesObservation(
  candidate: MemoryCandidate,
  observation: SurfaceObservation,
): boolean {
  return (
    candidate.sourcePath === observation.sourcePath &&
    candidate.claim.anchor === observation.anchor &&
    candidate.claim.sourcePath === observation.sourcePath &&
    candidate.claim.statement === observation.statement &&
    sameList(candidate.claim.operations, observation.operations)
  );
}

function supportedEvidence(evidence: {
  workflowStatus: string;
  verificationPassed: boolean;
  reviewOutcome: string | null;
}): evidence is SupportedMemoryEvidence {
  return (
    evidence.workflowStatus === "success" &&
    evidence.verificationPassed === true &&
    evidence.reviewOutcome === "pass"
  );
}

function failedRetrieval(
  repositoryScope: string,
  reason: string,
): MemoryRetrieval {
  return {
    repositoryScope,
    retrievedIds: [],
    validatedIds: [],
    rejectedStale: [{ id: "(store)", reason }],
    ignoredOutOfScope: 0,
    hint: null,
    metrics: {
      ...emptyMemoryMetrics(),
      memoryRejectedStale: 1,
    },
  };
}

function sameList(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}
