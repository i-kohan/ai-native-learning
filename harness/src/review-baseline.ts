import fs from "node:fs";
import path from "node:path";
import type { FileSnapshot } from "./diff.ts";
import { fingerprintSnapshot } from "./workspace.ts";
import { WorkflowError } from "./workflow-error.ts";
import type { ReviewBaselineRef } from "./workflow-state.ts";

const ARTIFACT_KIND = "pre_worker_file_snapshot";
const ARTIFACT_SCHEMA_VERSION = 1;

export function persistReviewBaseline(
  storeDir: string,
  workflowId: string,
  snapshot: FileSnapshot,
): ReviewBaselineRef {
  const artifactId = reviewBaselineArtifactId(workflowId);
  const fingerprint = fingerprintSnapshot(snapshot);
  const dest = reviewBaselinePath(storeDir, workflowId);
  const payload = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId,
    kind: ARTIFACT_KIND,
    fingerprint,
    files: Object.fromEntries(snapshot),
  };
  fs.mkdirSync(storeDir, { recursive: true });
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`);
    fs.renameSync(tmp, dest);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best-effort cleanup of a leftover temp file.
    }
    throw error;
  }
  return { artifactId, fingerprint };
}

export function loadReviewBaseline(
  storeDir: string,
  expected: ReviewBaselineRef,
): FileSnapshot {
  const dest = reviewBaselinePathFromRef(storeDir, expected.artifactId);
  if (!fs.existsSync(dest)) {
    throw new WorkflowError(
      "missing_state",
      `Review baseline artifact is missing: ${dest}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(dest, "utf8"));
  } catch {
    throw new WorkflowError(
      "corrupt_state",
      `Review baseline artifact is not valid JSON: ${dest}`,
    );
  }

  if (!isRecord(raw)) {
    throw new WorkflowError(
      "corrupt_state",
      "Review baseline artifact must be an object.",
    );
  }
  if (raw.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new WorkflowError(
      "unsupported_schema",
      `Unsupported review baseline schemaVersion: ${String(raw.schemaVersion)}.`,
    );
  }
  if (raw.kind !== ARTIFACT_KIND) {
    throw new WorkflowError(
      "corrupt_state",
      `Unsupported review baseline kind: ${String(raw.kind)}.`,
    );
  }
  if (raw.artifactId !== expected.artifactId) {
    throw new WorkflowError(
      "corrupt_state",
      `Review baseline artifactId ${String(raw.artifactId)} does not match ${expected.artifactId}.`,
    );
  }
  if (!isRecord(raw.files) || !filesAreStrings(raw.files)) {
    throw new WorkflowError(
      "corrupt_state",
      "Review baseline files must be a string map.",
    );
  }

  const snapshot: FileSnapshot = new Map(Object.entries(raw.files));
  const fingerprint = fingerprintSnapshot(snapshot);
  if (fingerprint !== expected.fingerprint || fingerprint !== raw.fingerprint) {
    throw new WorkflowError(
      "corrupt_state",
      "Review baseline fingerprint does not match persisted artifact.",
    );
  }
  return snapshot;
}

export function reviewBaselinePath(
  storeDir: string,
  workflowId: string,
): string {
  return path.join(storeDir, `${sanitizeId(workflowId)}.review-baseline.json`);
}

export function reviewBaselineArtifactId(workflowId: string): string {
  return `${sanitizeId(workflowId)}.review-baseline`;
}

function reviewBaselinePathFromRef(
  storeDir: string,
  artifactId: string,
): string {
  return path.join(storeDir, `${sanitizeId(artifactId)}.json`);
}

function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) {
    throw new WorkflowError(
      "corrupt_state",
      `Invalid review baseline id: ${id}`,
    );
  }
  return cleaned;
}

function filesAreStrings(
  value: Record<string, unknown>,
): value is Record<string, string> {
  return Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
