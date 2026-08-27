import { formatSpecContract, type Spec } from "./spec.ts";
import {
  formatSpecPhaseOrientation,
  type InspectedPaths,
  type RepositoryMap,
} from "./context.ts";
import { TOOL_DEFINITIONS } from "./tools.ts";

export const WORKER_PLAN_AUTHORITY_RULE =
  "Resolved Spec is authoritative. The Plan is an implementation hypothesis, not an authority boundary. Follow it where grounded, adapt to repository reality when needed, and never use it to expand or change the resolved Spec.";

export type PlanStep = {
  intent: string;
  likelyFiles: string[];
  dependsOn: number[];
};

export type Plan = {
  steps: PlanStep[];
  verificationIntent: string[];
  risks: string[];
};

export const SUBMIT_PLAN_TOOL = {
  type: "function" as const,
  name: "submit_plan",
  description:
    "Submit the structured advisory implementation Plan. This does not implement anything and does not authorize edits.",
  parameters: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              description: "What this step is trying to accomplish.",
            },
            likelyFiles: {
              type: "array",
              items: { type: "string" },
              description:
                "Hint paths only. Not an authorized edit scope or allowlist.",
            },
            dependsOn: {
              type: "array",
              items: { type: "integer" },
              description:
                "Zero-based indexes of other steps this step semantically follows.",
            },
          },
          required: ["intent", "likelyFiles", "dependsOn"],
          additionalProperties: false,
        },
      },
      verificationIntent: {
        type: "array",
        items: { type: "string" },
      },
      risks: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["steps", "verificationIntent", "risks"],
    additionalProperties: false,
  },
  strict: true,
};

export type ParsePlanResult =
  | { ok: true; value: Plan }
  | { ok: false; error: string };

export function parseSubmitPlan(argsJson: string): ParsePlanResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return { ok: false, error: "submit_plan arguments must be valid JSON." };
  }
  return parsePlanPayload(parsed);
}

export function parsePlanPayload(value: unknown): ParsePlanResult {
  if (!isRecord(value)) {
    return { ok: false, error: "submit_plan payload must be an object." };
  }

  const steps = parseSteps(value.steps);
  if (!steps.ok) {
    return steps;
  }
  const verificationIntent = parseStringArray(
    value.verificationIntent,
    "verificationIntent",
  );
  if (!verificationIntent.ok) {
    return verificationIntent;
  }
  const risks = parseStringArray(value.risks, "risks");
  if (!risks.ok) {
    return risks;
  }

  return {
    ok: true,
    value: {
      steps: steps.value,
      verificationIntent: verificationIntent.value,
      risks: risks.value,
    },
  };
}

export function shouldRunPlanner(planningEnabled: boolean): boolean {
  return planningEnabled === true;
}

export function formatWorkerTask(
  originalTask: string,
  spec: Spec,
  plan: Plan | null,
): string {
  if (!plan) {
    return formatSpecContract(originalTask, spec);
  }
  return formatWorkerHandoff(originalTask, spec, plan);
}

export function formatWorkerHandoff(
  originalTask: string,
  spec: Spec,
  plan: Plan,
): string {
  return [
    "## Authoritative specification",
    "Implement this contract. Do not invent product behavior beyond it.",
    "",
    JSON.stringify(spec, null, 2),
    "",
    "## Advisory implementation plan (not authority)",
    WORKER_PLAN_AUTHORITY_RULE,
    "likelyFiles are hints, not an authorized edit scope. You may inspect and edit any application source allowed by existing tools.",
    "Do not use this Plan to expand or change product semantics, permissions, tools, or scope.",
    "",
    JSON.stringify(plan, null, 2),
    "",
    "## Original task (provenance only)",
    originalTask,
  ].join("\n");
}

export function formatPlannerContext(options: {
  originalTask: string;
  spec: Spec;
  repositoryMap?: RepositoryMap;
  specInspectedPaths?: InspectedPaths;
}): string {
  const parts = [
    "## Authoritative resolved spec",
    "This Spec is the authority. The Plan must not expand, narrow, or rewrite it.",
    "",
    JSON.stringify(options.spec, null, 2),
    "",
    "## Original task (provenance only)",
    options.originalTask,
  ];

  if (options.repositoryMap) {
    parts.push("", formatSpecPhaseOrientation(options.repositoryMap));
  }

  if (options.specInspectedPaths) {
    parts.push(
      "",
      "## Spec phase inspected paths (hints, not edit scope)",
      formatInspectedPaths(options.specInspectedPaths),
    );
  }

  return parts.join("\n");
}

export function workerToolsForPlan(_plan: Plan | null) {
  return TOOL_DEFINITIONS;
}

export function plannedLikelyFiles(plan: Plan): string[] {
  const files: string[] = [];
  for (const step of plan.steps) {
    for (const file of step.likelyFiles) {
      if (!files.includes(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

export function planDeviation(
  plan: Plan,
  changedFiles: string[],
): {
  plannedLikelyFiles: string[];
  actualChangedFiles: string[];
  extraChangedFiles: string[];
  unusedLikelyFiles: string[];
} {
  const planned = plannedLikelyFiles(plan);
  const plannedNormalized = planned.map(normalizeHintPath);
  const actualNormalized = changedFiles.map(normalizeHintPath);

  return {
    plannedLikelyFiles: planned,
    actualChangedFiles: [...changedFiles],
    extraChangedFiles: changedFiles.filter(
      (file) => !plannedNormalized.includes(normalizeHintPath(file)),
    ),
    unusedLikelyFiles: planned.filter(
      (file) => !actualNormalized.includes(normalizeHintPath(file)),
    ),
  };
}

function parseSteps(
  value: unknown,
): { ok: true; value: PlanStep[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "steps must be a non-empty array." };
  }

  const steps: PlanStep[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseStep(value[index], index, value.length);
    if (!parsed.ok) {
      return parsed;
    }
    steps.push(parsed.value);
  }
  if (hasDependencyCycle(steps)) {
    return {
      ok: false,
      error: "steps contain a dependency cycle.",
    };
  }
  return { ok: true, value: steps };
}

function hasDependencyCycle(steps: PlanStep[]): boolean {
  const color = Array.from({ length: steps.length }, () => 0);
  const visit = (index: number): boolean => {
    if (color[index] === 1) {
      return true;
    }
    if (color[index] === 2) {
      return false;
    }
    color[index] = 1;
    for (const dependency of steps[index].dependsOn) {
      if (visit(dependency)) {
        return true;
      }
    }
    color[index] = 2;
    return false;
  };

  for (let index = 0; index < steps.length; index += 1) {
    if (color[index] === 0 && visit(index)) {
      return true;
    }
  }
  return false;
}

function parseStep(
  value: unknown,
  index: number,
  stepCount: number,
): { ok: true; value: PlanStep } | { ok: false; error: string } {
  const prefix = `steps[${index}]`;
  if (!isRecord(value)) {
    return { ok: false, error: `${prefix} must be an object.` };
  }
  if (typeof value.intent !== "string" || value.intent.trim() === "") {
    return { ok: false, error: `${prefix}.intent must be a non-empty string.` };
  }

  const likelyFiles = parseLikelyFiles(
    value.likelyFiles,
    `${prefix}.likelyFiles`,
  );
  if (!likelyFiles.ok) {
    return likelyFiles;
  }
  const dependsOn = parseDependsOn(
    value.dependsOn,
    `${prefix}.dependsOn`,
    index,
    stepCount,
  );
  if (!dependsOn.ok) {
    return dependsOn;
  }

  return {
    ok: true,
    value: {
      intent: value.intent.trim(),
      likelyFiles: likelyFiles.value,
      dependsOn: dependsOn.value,
    },
  };
}

function parseLikelyFiles(
  value: unknown,
  label: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: `${label} must be an array of strings.` };
  }
  const files: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      return { ok: false, error: `${label} must contain non-empty strings.` };
    }
    const path = item.trim();
    const invalid = invalidWorkspaceRelativePath(path);
    if (invalid) {
      return { ok: false, error: `${label}: ${invalid}` };
    }
    files.push(path);
  }
  return { ok: true, value: files };
}

function parseDependsOn(
  value: unknown,
  label: string,
  stepIndex: number,
  stepCount: number,
): { ok: true; value: number[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: `${label} must be an array of integers.` };
  }
  const indexes: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item)) {
      return { ok: false, error: `${label} must contain integers.` };
    }
    if (item === stepIndex) {
      return { ok: false, error: `${label} must not reference itself.` };
    }
    if (item < 0 || item >= stepCount) {
      return {
        ok: false,
        error: `${label} contains an invalid step index: ${item}.`,
      };
    }
    indexes.push(item);
  }
  return { ok: true, value: indexes };
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

export function invalidWorkspaceRelativePath(
  relativePath: string,
): string | null {
  const normalized = relativePath.replace(/\\/g, "/").trim();
  if (normalized === "") {
    return "path must be a non-empty workspace-relative path.";
  }
  if (pathIsAbsolute(normalized)) {
    return `absolute paths are not allowed: ${relativePath}`;
  }
  if (normalized.split("/").includes("..")) {
    return `path traversal is not allowed: ${relativePath}`;
  }
  return null;
}

function pathIsAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function formatInspectedPaths(paths: InspectedPaths): string {
  const readFiles =
    paths.readFiles.length > 0
      ? paths.readFiles.map((item) => `- ${item}`).join("\n")
      : "(none recorded)";
  const listedPaths =
    paths.listedPaths.length > 0
      ? paths.listedPaths.map((item) => `- ${item}`).join("\n")
      : "(none recorded)";
  return ["read_file:", readFiles, "", "list_files:", listedPaths].join("\n");
}

function normalizeHintPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^target-app\//, "")
    .replace(/^src\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
