/**
 * Harness-owned SwarmPlan admission.
 * The Lead may propose worker ids, objectives, and optional scope hints.
 * Resource limits and capabilities stay in SWARM_INVESTIGATION_POLICY.
 */

export const SWARM_INVESTIGATION_POLICY = {
  minWorkers: 2,
  maxWorkers: 3,
  maxRounds: 1,
  workersReadOnly: true,
  workersMayDelegate: false,
  workerMaxTurns: 10,
  leadPlanMaxTurns: 6,
  synthesisMaxTurns: 4,
  baselineMaxTurns: 16,
} as const;

const FORBIDDEN_AUTHORITY_KEYS = [
  "model",
  "tools",
  "maxTurns",
  "maxWorkers",
  "minWorkers",
  "delegation",
  "delegations",
  "rounds",
  "maxRounds",
  "writeAccess",
  "workersMayDelegate",
  "workersReadOnly",
] as const;

export type SwarmWorker = {
  id: string;
  objective: string;
  scopeHint?: string;
};

export type SwarmPlan = {
  workers: SwarmWorker[];
};

export type SwarmAdmission =
  | { ok: true; value: SwarmPlan }
  | { ok: false; error: string };

export function admitSwarmPlan(value: unknown): SwarmAdmission {
  if (!isRecord(value)) {
    return { ok: false, error: "SwarmPlan must be an object." };
  }

  const forbidden = forbiddenAuthorityKey(value);
  if (forbidden) {
    return {
      ok: false,
      error: `SwarmPlan must not set harness authority: ${forbidden}.`,
    };
  }

  if (!Array.isArray(value.workers)) {
    return { ok: false, error: "SwarmPlan.workers must be an array." };
  }

  const count = value.workers.length;
  if (
    count < SWARM_INVESTIGATION_POLICY.minWorkers ||
    count > SWARM_INVESTIGATION_POLICY.maxWorkers
  ) {
    return {
      ok: false,
      error: `SwarmPlan must contain ${SWARM_INVESTIGATION_POLICY.minWorkers} to ${SWARM_INVESTIGATION_POLICY.maxWorkers} workers.`,
    };
  }

  const workers: SwarmWorker[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.workers.length; index += 1) {
    const parsed = parseWorker(value.workers[index], index);
    if (!parsed.ok) {
      return parsed;
    }
    if (seen.has(parsed.value.id)) {
      return {
        ok: false,
        error: `Worker ids must be unique: ${parsed.value.id}.`,
      };
    }
    seen.add(parsed.value.id);
    workers.push(parsed.value);
  }

  return { ok: true, value: { workers } };
}

function parseWorker(
  value: unknown,
  index: number,
): { ok: true; value: SwarmWorker } | { ok: false; error: string } {
  const prefix = `workers[${index}]`;
  if (!isRecord(value)) {
    return { ok: false, error: `${prefix} must be an object.` };
  }
  const forbidden = forbiddenAuthorityKey(value);
  if (forbidden) {
    return {
      ok: false,
      error: `${prefix} must not set harness authority: ${forbidden}.`,
    };
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    return { ok: false, error: `${prefix}.id must be a non-empty string.` };
  }
  if (typeof value.objective !== "string" || value.objective.trim() === "") {
    return {
      ok: false,
      error: `${prefix}.objective must be a non-empty string.`,
    };
  }
  const id = value.id.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(id)) {
    return {
      ok: false,
      error: `${prefix}.id must be a short token of letters, numbers, "_" or "-".`,
    };
  }
  const objective = value.objective.trim();
  if (objective.length > 2000) {
    return {
      ok: false,
      error: `${prefix}.objective exceeds the harness length limit.`,
    };
  }
  const worker: SwarmWorker = { id, objective };
  if (value.scopeHint !== undefined) {
    if (typeof value.scopeHint !== "string") {
      return { ok: false, error: `${prefix}.scopeHint must be a string.` };
    }
    const scopeHint = value.scopeHint.trim();
    if (scopeHint.length > 500) {
      return {
        ok: false,
        error: `${prefix}.scopeHint exceeds the harness length limit.`,
      };
    }
    if (scopeHint !== "") {
      worker.scopeHint = scopeHint;
    }
  }
  return { ok: true, value: worker };
}

function forbiddenAuthorityKey(value: Record<string, unknown>): string | null {
  for (const key of FORBIDDEN_AUTHORITY_KEYS) {
    if (key in value) {
      return key;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
