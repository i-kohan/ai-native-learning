import { formatSpecContract, type Spec } from "./spec.ts";

export const FAN_OUT_PLAN_RULE =
  "FanOutPlan is harness-owned scheduling and process control. It is not Spec, permission, or a new source of product semantics. The full resolved Spec remains authoritative.";

export const FAN_OUT_UNIT_SCOPE_RULE =
  "FanOutUnit scope is harness-owned process control for this child episode only. Implement only this unit. Do not implement sibling units. Sibling units run in other isolated children and will be integrated later. This scope does not add, remove, or rewrite product requirements.";

export const FAN_OUT_MAX_PARALLEL_WORKERS = 2;

export type FanOutSchedule = "sequential" | "parallel";

export type FanOutUnit = {
  id: string;
  intent: string;
  acceptanceRefs: string[];
  verificationIntent: string[];
  testFiles: string[];
  dependsOn: [];
};

export type FanOutPlan = {
  baseRevision: string;
  maxParallelWorkers: typeof FAN_OUT_MAX_PARALLEL_WORKERS;
  integrationOrder: string[];
  units: FanOutUnit[];
};

export type ParseFanOutPlanResult =
  | { ok: true; value: FanOutPlan }
  | { ok: false; error: string };

export type FanOutUnitTemplate = {
  id: string;
  intent: string;
  verificationIntent: string[];
  testFiles: string[];
};

export type FanOutUnitExecutionScope = {
  currentUnitId: string;
  currentIntent: string;
  acceptanceRefs: string[];
  siblingUnits: Array<{ id: string; intent: string }>;
};

export function fanOutUnitExecutionScope(
  plan: FanOutPlan,
  current: FanOutUnit,
): FanOutUnitExecutionScope {
  return {
    currentUnitId: current.id,
    currentIntent: current.intent,
    acceptanceRefs: [...current.acceptanceRefs],
    siblingUnits: plan.units
      .filter((unit) => unit.id !== current.id)
      .map((unit) => ({ id: unit.id, intent: unit.intent })),
  };
}

export function admitFanOutPlan(
  plan: FanOutPlan,
  spec: Spec,
): ParseFanOutPlanResult {
  const parsed = parseFanOutPlanPayload(plan);
  if (!parsed.ok) {
    return parsed;
  }
  return validateFanOutAgainstSpec(parsed.value, spec);
}

export function parseFanOutPlanPayload(value: unknown): ParseFanOutPlanResult {
  if (!isRecord(value)) {
    return { ok: false, error: "FanOutPlan must be an object." };
  }
  if (
    typeof value.baseRevision !== "string" ||
    !isExactCommitSha(value.baseRevision)
  ) {
    return {
      ok: false,
      error: "baseRevision must be an exact 40-character commit SHA.",
    };
  }
  if (value.maxParallelWorkers !== FAN_OUT_MAX_PARALLEL_WORKERS) {
    return {
      ok: false,
      error: `maxParallelWorkers must be ${FAN_OUT_MAX_PARALLEL_WORKERS}.`,
    };
  }
  const units = parseUnits(value.units);
  if (!units.ok) {
    return units;
  }
  const integrationOrder = parseStringArray(
    value.integrationOrder,
    "integrationOrder",
  );
  if (!integrationOrder.ok) {
    return integrationOrder;
  }
  const orderError = exactPermutationError(
    integrationOrder.value,
    units.value.map((unit) => unit.id),
  );
  if (orderError) {
    return { ok: false, error: orderError };
  }
  return {
    ok: true,
    value: {
      baseRevision: value.baseRevision,
      maxParallelWorkers: FAN_OUT_MAX_PARALLEL_WORKERS,
      integrationOrder: integrationOrder.value,
      units: units.value,
    },
  };
}

export function bindFanOutPlanFromTemplates(
  spec: Spec,
  baseRevision: string,
  templates: FanOutUnitTemplate[],
  integrationOrder: string[],
): ParseFanOutPlanResult {
  if (templates.length === 0) {
    return { ok: false, error: "FanOutPlan templates must not be empty." };
  }
  const assignments = new Map<string, string[]>();
  for (const template of templates) {
    assignments.set(template.id, []);
  }

  for (const criterion of spec.acceptance) {
    for (const template of templates) {
      assignments.get(template.id)?.push(criterion);
    }
  }

  const units: FanOutUnit[] = templates.map((template) => ({
    id: template.id,
    intent: template.intent,
    acceptanceRefs: assignments.get(template.id) ?? [],
    verificationIntent: [...template.verificationIntent],
    testFiles: [...template.testFiles],
    dependsOn: [],
  }));

  return admitFanOutPlan(
    {
      baseRevision,
      maxParallelWorkers: FAN_OUT_MAX_PARALLEL_WORKERS,
      integrationOrder,
      units,
    },
    spec,
  );
}

export function unitsInIntegrationOrder(plan: FanOutPlan): FanOutUnit[] {
  const byId = new Map(plan.units.map((unit) => [unit.id, unit]));
  return plan.integrationOrder.map((id) => {
    const unit = byId.get(id);
    if (!unit) {
      throw new Error(`FanOutPlan integrationOrder cites unknown unit: ${id}`);
    }
    return unit;
  });
}

export function formatWorkerFanOutUnitTask(
  originalTask: string,
  spec: Spec,
  plan: FanOutPlan,
  unit: FanOutUnit,
): string {
  const scope = fanOutUnitExecutionScope(plan, unit);
  return [
    "## Authoritative specification",
    "This is the final product contract. Do not invent behavior beyond it.",
    "Sibling units remain required by this Spec even if they are out of scope for this child.",
    "",
    JSON.stringify(spec, null, 2),
    "",
    "## FanOutPlan (harness-owned process control, not product semantics)",
    FAN_OUT_PLAN_RULE,
    `baseRevision: ${plan.baseRevision}`,
    `maxParallelWorkers: ${plan.maxParallelWorkers}`,
    `integrationOrder: ${plan.integrationOrder.join(" → ")}`,
    "",
    "## FanOutUnitExecutionScope (harness-owned, this child only)",
    FAN_OUT_UNIT_SCOPE_RULE,
    JSON.stringify(scope, null, 2),
    "",
    "## Current unit",
    JSON.stringify(unit, null, 2),
    "",
    "## Original task (provenance only)",
    originalTask,
  ].join("\n");
}

export function formatWorkerTaskWithFanOutPlan(
  originalTask: string,
  spec: Spec,
  plan: FanOutPlan | null,
): string {
  if (!plan) {
    return formatSpecContract(originalTask, spec);
  }
  return [
    formatSpecContract(originalTask, spec),
    "",
    "## FanOutPlan (not product authority)",
    FAN_OUT_PLAN_RULE,
    JSON.stringify(plan, null, 2),
  ].join("\n");
}

export function existingBehaviorTestFiles(): string[] {
  return ["tests/tasks.test.ts"];
}

export function childVerificationFiles(unit: FanOutUnit): string[] {
  const files = [...existingBehaviorTestFiles()];
  for (const file of unit.testFiles) {
    if (!files.includes(file)) {
      files.push(file);
    }
  }
  return files;
}

function validateFanOutAgainstSpec(
  plan: FanOutPlan,
  spec: Spec,
): ParseFanOutPlanResult {
  const acceptance = spec.acceptance.map((item) => item.trim());
  for (const unit of plan.units) {
    for (const ref of unit.acceptanceRefs) {
      if (!acceptance.includes(ref)) {
        return {
          ok: false,
          error: `unit ${unit.id} acceptanceRefs cites a criterion not in Spec.acceptance: ${ref}`,
        };
      }
    }
  }

  if (plan.units.length === 0) {
    return { ok: false, error: "FanOutPlan must contain at least one unit." };
  }

  const owned = new Set(plan.units.flatMap((unit) => unit.acceptanceRefs));
  const missing = acceptance.filter((item) => !owned.has(item));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `FanOutPlan is missing Spec.acceptance coverage: ${missing.join(" | ")}`,
    };
  }
  return { ok: true, value: plan };
}

function parseUnits(
  value: unknown,
): { ok: true; value: FanOutUnit[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "units must be an array." };
  }
  if (value.length === 0) {
    return { ok: false, error: "FanOutPlan units must be a non-empty array." };
  }

  const units: FanOutUnit[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseUnit(value[index], index);
    if (!parsed.ok) {
      return parsed;
    }
    if (ids.has(parsed.value.id)) {
      return { ok: false, error: `unit id is not unique: ${parsed.value.id}` };
    }
    ids.add(parsed.value.id);
    units.push(parsed.value);
  }
  return { ok: true, value: units };
}

function parseUnit(
  value: unknown,
  index: number,
): { ok: true; value: FanOutUnit } | { ok: false; error: string } {
  const prefix = `units[${index}]`;
  if (!isRecord(value)) {
    return { ok: false, error: `${prefix} must be an object.` };
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    return { ok: false, error: `${prefix}.id must be a non-empty string.` };
  }
  if (typeof value.intent !== "string" || value.intent.trim() === "") {
    return { ok: false, error: `${prefix}.intent must be a non-empty string.` };
  }
  const acceptanceRefs = parseStringArray(
    value.acceptanceRefs,
    `${prefix}.acceptanceRefs`,
  );
  if (!acceptanceRefs.ok) {
    return acceptanceRefs;
  }
  const verificationIntent = parseStringArray(
    value.verificationIntent,
    `${prefix}.verificationIntent`,
  );
  if (!verificationIntent.ok) {
    return verificationIntent;
  }
  const testFiles = parseStringArray(value.testFiles, `${prefix}.testFiles`);
  if (!testFiles.ok) {
    return testFiles;
  }
  const dependsOn = parseStringArray(value.dependsOn, `${prefix}.dependsOn`);
  if (!dependsOn.ok) {
    return dependsOn;
  }
  if (dependsOn.value.length > 0) {
    return {
      ok: false,
      error: `unit ${value.id.trim()} must not declare dependencies between admitted fan-out units.`,
    };
  }
  return {
    ok: true,
    value: {
      id: value.id.trim(),
      intent: value.intent.trim(),
      acceptanceRefs: acceptanceRefs.value,
      verificationIntent: verificationIntent.value,
      testFiles: testFiles.value,
      dependsOn: [],
    },
  };
}

function exactPermutationError(
  order: string[],
  unitIds: string[],
): string | null {
  if (order.length !== unitIds.length) {
    return "integrationOrder must be an exact permutation of the units.";
  }
  const seen = new Set<string>();
  const idSet = new Set(unitIds);
  for (const id of order) {
    if (!idSet.has(id)) {
      return `integrationOrder cites unknown unit: ${id}`;
    }
    if (seen.has(id)) {
      return `integrationOrder repeats unit: ${id}`;
    }
    seen.add(id);
  }
  return null;
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

function isExactCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
