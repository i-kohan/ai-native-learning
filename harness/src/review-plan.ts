import fs from "node:fs";
import { formatSpecContract, type Spec } from "./spec.ts";

export const REVIEW_PLAN_AUTHORITY_RULE =
  "Resolved Spec is authoritative. The ReviewPlan is advisory review decomposition, not Spec, permission, success criteria, or an implementation constraint. Follow it where grounded, adapt to repository reality when needed, and never use it to expand or change the resolved Spec.";

export type ReviewPlanDecision = "single_change" | "decompose";

export type ChangeUnit = {
  id: string;
  intent: string;
  acceptanceRefs: string[];
  dependsOn: string[];
  verificationIntent: string[];
};

export type ReviewPlan = {
  decision: ReviewPlanDecision;
  rationale: string;
  units: ChangeUnit[];
};

export type ParseReviewPlanResult =
  | { ok: true; value: ReviewPlan }
  | { ok: false; error: string };

export type ReviewUnitReport = {
  id: string;
  intent: string;
  acceptanceRefs: string[];
  dependsOn: string[];
  changedFiles: string[];
  unifiedDiff: string;
  verificationPassed: boolean;
  verificationOutput: string;
  repairAttempts: number;
  modelCalls: number;
  toolCalls: number;
  durationMs: number;
  deviation: string | null;
};

export type ChangeUnitTemplate = {
  id: string;
  intent: string;
  dependsOn: string[];
  verificationIntent: string[];
  testFiles: string[];
  score: (acceptance: string) => number;
};

export function admitReviewPlan(
  plan: ReviewPlan,
  spec: Spec,
): ParseReviewPlanResult {
  const parsed = parseReviewPlanPayload(plan);
  if (!parsed.ok) {
    return parsed;
  }
  return validateAgainstSpec(parsed.value, spec);
}

export function parseReviewPlanPayload(value: unknown): ParseReviewPlanResult {
  if (!isRecord(value)) {
    return { ok: false, error: "ReviewPlan must be an object." };
  }
  if (value.decision !== "single_change" && value.decision !== "decompose") {
    return {
      ok: false,
      error: 'decision must be "single_change" or "decompose".',
    };
  }
  if (typeof value.rationale !== "string" || value.rationale.trim() === "") {
    return { ok: false, error: "rationale must be a non-empty string." };
  }
  const units = parseUnits(value.units, value.decision);
  if (!units.ok) {
    return units;
  }
  return {
    ok: true,
    value: {
      decision: value.decision,
      rationale: value.rationale.trim(),
      units: units.value,
    },
  };
}

export function bindReviewPlanFromTemplates(
  spec: Spec,
  templates: ChangeUnitTemplate[],
  rationale: string,
): ParseReviewPlanResult {
  const assignments = new Map<string, string[]>();
  for (const template of templates) {
    assignments.set(template.id, []);
  }

  for (const criterion of spec.acceptance) {
    let bestId = templates[0]?.id;
    let bestScore = -1;
    for (const template of templates) {
      const score = template.score(criterion);
      if (score > bestScore) {
        bestScore = score;
        bestId = template.id;
      }
    }
    if (!bestId) {
      return { ok: false, error: "ReviewPlan templates must not be empty." };
    }
    assignments.get(bestId)?.push(criterion);
  }

  const units: ChangeUnit[] = templates.map((template) => ({
    id: template.id,
    intent: template.intent,
    acceptanceRefs: assignments.get(template.id) ?? [],
    dependsOn: [...template.dependsOn],
    verificationIntent: [...template.verificationIntent],
  }));

  return admitReviewPlan(
    {
      decision: "decompose",
      rationale,
      units,
    },
    spec,
  );
}

export function orderedUnits(plan: ReviewPlan): ChangeUnit[] {
  const remaining = new Set(plan.units.map((unit) => unit.id));
  const ordered: ChangeUnit[] = [];
  while (remaining.size > 0) {
    const ready = plan.units.filter(
      (unit) =>
        remaining.has(unit.id) &&
        unit.dependsOn.every((dependency) => !remaining.has(dependency)),
    );
    if (ready.length === 0) {
      return plan.units;
    }
    ordered.push(ready[0]);
    remaining.delete(ready[0].id);
  }
  return ordered;
}

export function formatWorkerUnitTask(
  originalTask: string,
  spec: Spec,
  unit: ChangeUnit,
): string {
  return [
    "## Authoritative specification",
    "Implement this contract. Do not invent product behavior beyond it.",
    "",
    JSON.stringify(spec, null, 2),
    "",
    "## Current review unit (advisory, not authority)",
    REVIEW_PLAN_AUTHORITY_RULE,
    "Implement only this unit. Do not implement later units.",
    "Previous units are already in the repository; inspect them if needed.",
    "Do not use this unit to expand product semantics, permissions, tools, or success criteria.",
    "",
    JSON.stringify(unit, null, 2),
    "",
    "## Original task (provenance only)",
    originalTask,
  ].join("\n");
}

export function formatWorkerTaskWithReviewPlan(
  originalTask: string,
  spec: Spec,
  plan: ReviewPlan | null,
): string {
  if (!plan) {
    return formatSpecContract(originalTask, spec);
  }
  return [
    formatSpecContract(originalTask, spec),
    "",
    "## Advisory ReviewPlan (not authority)",
    REVIEW_PLAN_AUTHORITY_RULE,
    JSON.stringify(plan, null, 2),
  ].join("\n");
}

export function existingBehaviorTestFiles(): string[] {
  return ["tests/tasks.test.ts"];
}

export function unitTestFiles(
  unitId: string,
  templates: ChangeUnitTemplate[],
): string[] {
  return templates.find((item) => item.id === unitId)?.testFiles ?? [];
}

export function cumulativeTestFiles(
  completedUnitIds: string[],
  templates: ChangeUnitTemplate[],
): string[] {
  const files = [...existingBehaviorTestFiles()];
  for (const id of completedUnitIds) {
    for (const file of unitTestFiles(id, templates)) {
      if (!files.includes(file)) {
        files.push(file);
      }
    }
  }
  return files;
}

export function formatReviewabilityReport(options: {
  plan: ReviewPlan;
  units: ReviewUnitReport[];
  finalChangedFiles: string[];
  finalUnifiedDiff: string;
}): string {
  const lines = [
    "# Reviewability report",
    "",
    REVIEW_PLAN_AUTHORITY_RULE,
    "",
    `decision: ${options.plan.decision}`,
    `rationale: ${options.plan.rationale}`,
    "",
  ];

  for (const unit of options.units) {
    lines.push(
      `## Unit ${unit.id}`,
      "",
      `intent: ${unit.intent}`,
      "",
      "acceptance:",
      ...unit.acceptanceRefs.map((item) => `- ${item}`),
      "",
      `dependsOn: ${unit.dependsOn.join(", ") || "(none)"}`,
      `changedFiles: ${unit.changedFiles.join(", ") || "(none)"}`,
      `verification: ${unit.verificationPassed ? "PASS" : "FAIL"}`,
      `repairAttempts: ${unit.repairAttempts}`,
      `modelCalls: ${unit.modelCalls}`,
      `toolCalls: ${unit.toolCalls}`,
      `diffLines: ${diffLineCount(unit.unifiedDiff)}`,
      `deviation: ${unit.deviation ?? "(none)"}`,
      "",
      "```diff",
      unit.unifiedDiff.trim() || "(empty)",
      "```",
      "",
    );
  }

  lines.push(
    "## Final full diff",
    "",
    `changedFiles: ${options.finalChangedFiles.join(", ") || "(none)"}`,
    `diffLines: ${diffLineCount(options.finalUnifiedDiff)}`,
    "",
    "```diff",
    options.finalUnifiedDiff.trim() || "(empty)",
    "```",
    "",
  );
  return lines.join("\n");
}

export function diffLineCount(diff: string): number {
  if (!diff.trim()) {
    return 0;
  }
  return diff.split("\n").length;
}

export function writeReviewabilityReport(
  tracePath: string,
  markdown: string,
): string {
  const outPath = tracePath.replace(/\.jsonl$/, ".review-units.md");
  fs.writeFileSync(
    outPath,
    markdown.endsWith("\n") ? markdown : `${markdown}\n`,
  );
  return outPath;
}

function validateAgainstSpec(
  plan: ReviewPlan,
  spec: Spec,
): ParseReviewPlanResult {
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

  if (plan.decision === "decompose") {
    if (plan.units.length === 0) {
      return {
        ok: false,
        error: "decompose ReviewPlan must contain at least one unit.",
      };
    }
    const owned = new Set(plan.units.flatMap((unit) => unit.acceptanceRefs));
    const missing = acceptance.filter((item) => !owned.has(item));
    if (missing.length > 0) {
      return {
        ok: false,
        error: `decompose ReviewPlan is missing Spec.acceptance coverage: ${missing.join(" | ")}`,
      };
    }
  }

  return { ok: true, value: plan };
}

function parseUnits(
  value: unknown,
  decision: ReviewPlanDecision,
): { ok: true; value: ChangeUnit[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "units must be an array." };
  }
  if (decision === "single_change" && value.length === 0) {
    return { ok: true, value: [] };
  }
  if (decision === "decompose" && value.length === 0) {
    return {
      ok: false,
      error: "decompose ReviewPlan units must be a non-empty array.",
    };
  }

  const units: ChangeUnit[] = [];
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

  for (const unit of units) {
    for (const dependency of unit.dependsOn) {
      if (!ids.has(dependency)) {
        return {
          ok: false,
          error: `unit ${unit.id} dependsOn unknown unit: ${dependency}`,
        };
      }
      if (dependency === unit.id) {
        return {
          ok: false,
          error: `unit ${unit.id} must not depend on itself.`,
        };
      }
    }
  }

  if (hasDependencyCycle(units)) {
    return { ok: false, error: "units contain a dependency cycle." };
  }
  return { ok: true, value: units };
}

function parseUnit(
  value: unknown,
  index: number,
): { ok: true; value: ChangeUnit } | { ok: false; error: string } {
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
  const dependsOn = parseStringArray(value.dependsOn, `${prefix}.dependsOn`);
  if (!dependsOn.ok) {
    return dependsOn;
  }
  const verificationIntent = parseStringArray(
    value.verificationIntent,
    `${prefix}.verificationIntent`,
  );
  if (!verificationIntent.ok) {
    return verificationIntent;
  }
  return {
    ok: true,
    value: {
      id: value.id.trim(),
      intent: value.intent.trim(),
      acceptanceRefs: acceptanceRefs.value,
      dependsOn: dependsOn.value,
      verificationIntent: verificationIntent.value,
    },
  };
}

function hasDependencyCycle(units: ChangeUnit[]): boolean {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const color = new Map<string, 0 | 1 | 2>();
  for (const unit of units) {
    color.set(unit.id, 0);
  }
  const visit = (id: string): boolean => {
    const state = color.get(id) ?? 0;
    if (state === 1) {
      return true;
    }
    if (state === 2) {
      return false;
    }
    color.set(id, 1);
    const unit = byId.get(id);
    for (const dependency of unit?.dependsOn ?? []) {
      if (visit(dependency)) {
        return true;
      }
    }
    color.set(id, 2);
    return false;
  };
  return units.some((unit) => visit(unit.id));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
