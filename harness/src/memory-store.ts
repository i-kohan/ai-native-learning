import fs from "node:fs";
import path from "node:path";

export const MEMORY_KIND = "implementation_surface" as const;

export type MemoryKind = typeof MEMORY_KIND;

export type ImplementationSurfaceClaim = {
  statement: string;
  anchor: string;
  sourcePath: string;
  operations: string[];
};

export type SupportedMemoryEvidence = {
  verificationPassed: true;
  reviewOutcome: "pass";
  workflowStatus: "success";
};

export type MemoryRecord = {
  id: string;
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
  status: "admitted";
};

export class MemoryStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryStoreError";
  }
}

export function saveMemoryRecord(storeDir: string, record: MemoryRecord): void {
  const parsed = parseMemoryRecord(record);
  if (!parsed.ok) {
    throw new MemoryStoreError(parsed.reason);
  }
  fs.mkdirSync(storeDir, { recursive: true });
  const dest = memoryRecordPath(storeDir, parsed.value.id);
  if (fs.existsSync(dest)) {
    const existing = loadMemoryRecord(storeDir, parsed.value.id);
    if (stableJson(existing) === stableJson(parsed.value)) {
      return;
    }
    throw new MemoryStoreError(
      `Refusing to rewrite admitted memory ${parsed.value.id}.`,
    );
  }
  replaceMemoryFile(dest, parsed.value);
}

export function loadMemoryRecord(storeDir: string, id: string): MemoryRecord {
  const dest = memoryRecordPath(storeDir, id);
  if (!fs.existsSync(dest)) {
    throw new MemoryStoreError(`Memory record is missing: ${dest}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(dest, "utf8"));
  } catch {
    throw new MemoryStoreError(`Memory record is not valid JSON: ${dest}`);
  }
  const parsed = parseMemoryRecord(raw);
  if (!parsed.ok) {
    throw new MemoryStoreError(parsed.reason);
  }
  if (parsed.value.id !== id) {
    throw new MemoryStoreError(
      `Persisted memory id ${parsed.value.id} does not match ${id}.`,
    );
  }
  return parsed.value;
}

export function listMemoryRecords(storeDir: string): MemoryRecord[] {
  if (!fs.existsSync(storeDir)) {
    return [];
  }
  const names = fs
    .readdirSync(storeDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return names.map((name) =>
    loadMemoryRecord(storeDir, name.slice(0, -".json".length)),
  );
}

export function parseMemoryRecord(
  value: unknown,
): { ok: true; value: MemoryRecord } | { ok: false; reason: string } {
  if (!isRecord(value)) {
    return { ok: false, reason: "Memory record must be an object." };
  }
  const unexpected = unexpectedField(value, RECORD_FIELDS);
  if (unexpected) {
    return { ok: false, reason: unexpected };
  }
  const id = parseId(value.id);
  if (!id.ok) {
    return id;
  }
  if (value.kind !== MEMORY_KIND) {
    return { ok: false, reason: "Unsupported memory kind." };
  }
  if (value.status !== "admitted") {
    return { ok: false, reason: "Memory status must be admitted." };
  }
  const repositoryScope = parseToken(value.repositoryScope, "repositoryScope");
  if (!repositoryScope.ok) {
    return repositoryScope;
  }
  const claim = parseClaim(value.claim);
  if (!claim.ok) {
    return claim;
  }
  const sourcePath = parseRepoPath(value.sourcePath);
  if (!sourcePath.ok) {
    return sourcePath;
  }
  if (sourcePath.value !== claim.value.sourcePath) {
    return { ok: false, reason: "sourcePath does not match the claim." };
  }
  const sourceFingerprint = parseSha256(value.sourceFingerprint);
  if (!sourceFingerprint.ok) {
    return sourceFingerprint;
  }
  const baseRevision = parseToken(value.baseRevision, "baseRevision");
  if (!baseRevision.ok) {
    return baseRevision;
  }
  const observedAt = parseTimestamp(value.observedAt);
  if (!observedAt.ok) {
    return observedAt;
  }
  const originatingWorkflowId = parseToken(
    value.originatingWorkflowId,
    "originatingWorkflowId",
  );
  if (!originatingWorkflowId.ok) {
    return originatingWorkflowId;
  }
  const originatingRunId = parseToken(
    value.originatingRunId,
    "originatingRunId",
  );
  if (!originatingRunId.ok) {
    return originatingRunId;
  }
  const evidence = parseEvidence(value.evidence);
  if (!evidence.ok) {
    return evidence;
  }
  return {
    ok: true,
    value: {
      id: id.value,
      kind: MEMORY_KIND,
      repositoryScope: repositoryScope.value,
      claim: claim.value,
      sourcePath: sourcePath.value,
      sourceFingerprint: sourceFingerprint.value,
      baseRevision: baseRevision.value,
      observedAt: observedAt.value,
      originatingWorkflowId: originatingWorkflowId.value,
      originatingRunId: originatingRunId.value,
      evidence: evidence.value,
      status: "admitted",
    },
  };
}

const RECORD_FIELDS = [
  "id",
  "kind",
  "repositoryScope",
  "claim",
  "sourcePath",
  "sourceFingerprint",
  "baseRevision",
  "observedAt",
  "originatingWorkflowId",
  "originatingRunId",
  "evidence",
  "status",
] as const;

const CLAIM_FIELDS = [
  "statement",
  "anchor",
  "sourcePath",
  "operations",
] as const;
const EVIDENCE_FIELDS = [
  "verificationPassed",
  "reviewOutcome",
  "workflowStatus",
] as const;

function memoryRecordPath(storeDir: string, id: string): string {
  if (!/^mem-[a-f0-9]{16}$/.test(id)) {
    throw new MemoryStoreError(`Invalid memory id: ${id}`);
  }
  return path.join(storeDir, `${id}.json`);
}

function replaceMemoryFile(dest: string, record: MemoryRecord): void {
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
    fs.renameSync(tmp, dest);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best-effort cleanup of a leftover temp file.
    }
    throw error;
  }
}

function parseClaim(
  value: unknown,
):
  | { ok: true; value: ImplementationSurfaceClaim }
  | { ok: false; reason: string } {
  if (!isRecord(value)) {
    return { ok: false, reason: "Memory claim must be an object." };
  }
  const unexpected = unexpectedField(value, CLAIM_FIELDS);
  if (unexpected) {
    return { ok: false, reason: unexpected };
  }
  const anchor = parseIdentifier(value.anchor, "anchor");
  if (!anchor.ok) {
    return anchor;
  }
  const sourcePath = parseRepoPath(value.sourcePath);
  if (!sourcePath.ok) {
    return sourcePath;
  }
  const operations = parseOperations(value.operations);
  if (!operations.ok) {
    return operations;
  }
  const statement = `Core task-domain operations are implemented by ${anchor.value} in ${sourcePath.value}`;
  if (value.statement !== statement) {
    return {
      ok: false,
      reason: "Claim statement does not match structured fields.",
    };
  }
  return {
    ok: true,
    value: {
      statement,
      anchor: anchor.value,
      sourcePath: sourcePath.value,
      operations: operations.value,
    },
  };
}

function parseEvidence(
  value: unknown,
):
  | { ok: true; value: SupportedMemoryEvidence }
  | { ok: false; reason: string } {
  if (!isRecord(value)) {
    return { ok: false, reason: "Memory evidence must be an object." };
  }
  const unexpected = unexpectedField(value, EVIDENCE_FIELDS);
  if (unexpected) {
    return { ok: false, reason: unexpected };
  }
  if (
    value.verificationPassed !== true ||
    value.reviewOutcome !== "pass" ||
    value.workflowStatus !== "success"
  ) {
    return {
      ok: false,
      reason: "Memory evidence is not a verified review pass.",
    };
  }
  return {
    ok: true,
    value: {
      verificationPassed: true,
      reviewOutcome: "pass",
      workflowStatus: "success",
    },
  };
}

function parseOperations(
  value: unknown,
): { ok: true; value: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: "Memory operations must be a non-empty list." };
  }
  const operations: string[] = [];
  for (const item of value) {
    const parsed = parseIdentifier(item, "operation");
    if (!parsed.ok) {
      return parsed;
    }
    operations.push(parsed.value);
  }
  const sorted = [...operations].sort();
  if (operations.some((item, index) => item !== sorted[index])) {
    return { ok: false, reason: "Memory operations must be sorted." };
  }
  if (new Set(operations).size !== operations.length) {
    return { ok: false, reason: "Memory operations must be unique." };
  }
  return { ok: true, value: operations };
}

function parseId(
  value: unknown,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || !/^mem-[a-f0-9]{16}$/.test(value)) {
    return { ok: false, reason: "Memory id is invalid." };
  }
  return { ok: true, value };
}

function parseSha256(
  value: unknown,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    return {
      ok: false,
      reason: "sourceFingerprint must be a sha256 hex digest.",
    };
  }
  return { ok: true, value };
}

function parseRepoPath(
  value: unknown,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (
    typeof value !== "string" ||
    !value.startsWith("target-app/") ||
    value.includes("..") ||
    value.includes("\\")
  ) {
    return { ok: false, reason: "sourcePath must stay inside target-app/." };
  }
  return { ok: true, value };
}

function parseIdentifier(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]+$/.test(value)) {
    return { ok: false, reason: `${field} must be an identifier.` };
  }
  return { ok: true, value };
}

function parseToken(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 300 ||
    /[\s\u0000-\u001f]/.test(value)
  ) {
    return { ok: false, reason: `${field} is invalid.` };
  }
  return { ok: true, value };
}

function parseTimestamp(
  value: unknown,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return { ok: false, reason: "observedAt must be a timestamp." };
  }
  return { ok: true, value };
}

function unexpectedField(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  return extra ? `Unexpected memory field: ${extra}` : null;
}

function stableJson(record: MemoryRecord): string {
  return JSON.stringify(record);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
