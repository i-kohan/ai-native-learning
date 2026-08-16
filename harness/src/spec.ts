import fs from "node:fs";
import path from "node:path";

export type AmbiguityClassification =
  | "repository_resolvable"
  | "safe_inference"
  | "requires_human_judgment";

export type AmbiguityStatus = "resolved" | "unresolved";

export type Ambiguity = {
  question: string;
  classification: AmbiguityClassification;
  status: AmbiguityStatus;
  /** Filled when resolved; empty when unresolved. */
  resolution: string;
  /** Evidence from the repository or reasoning basis. */
  basis: string;
};

export type Spec = {
  goal: string;
  requirements: string[];
  constraints: string[];
  nonGoals: string[];
  acceptance: string[];
  verification: string[];
  ambiguities: Ambiguity[];
};

export type SpecDecision =
  | {
      status: "executable";
      spec: Spec;
    }
  | {
      status: "needs_human_judgment";
      spec: Spec;
      unresolvedQuestions: Ambiguity[];
    };

export const SUBMIT_SPEC_TOOL = {
  type: "function" as const,
  name: "submit_spec",
  description:
    "Submit the structured specification decision. Call this after inspecting the repository as needed. This does not implement anything.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["executable", "needs_human_judgment"],
        description:
          "executable = implementation may start. needs_human_judgment = stop; do not implement.",
      },
      spec: {
        type: "object",
        properties: {
          goal: { type: "string" },
          requirements: { type: "array", items: { type: "string" } },
          constraints: { type: "array", items: { type: "string" } },
          nonGoals: { type: "array", items: { type: "string" } },
          acceptance: { type: "array", items: { type: "string" } },
          verification: { type: "array", items: { type: "string" } },
          ambiguities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                classification: {
                  type: "string",
                  enum: [
                    "repository_resolvable",
                    "safe_inference",
                    "requires_human_judgment",
                  ],
                },
                status: {
                  type: "string",
                  enum: ["resolved", "unresolved"],
                },
                resolution: {
                  type: "string",
                  description: "Filled when resolved; empty when unresolved.",
                },
                basis: {
                  type: "string",
                  description:
                    "Evidence from code/tests/docs, or reasoning basis.",
                },
              },
              required: [
                "question",
                "classification",
                "status",
                "resolution",
                "basis",
              ],
              additionalProperties: false,
            },
          },
        },
        required: [
          "goal",
          "requirements",
          "constraints",
          "nonGoals",
          "acceptance",
          "verification",
          "ambiguities",
        ],
        additionalProperties: false,
      },
    },
    required: ["status", "spec"],
    additionalProperties: false,
  },
  strict: true,
};

export type ParseSpecResult =
  | { ok: true; value: { status: SpecDecision["status"]; spec: Spec } }
  | { ok: false; error: string };

export function parseSubmitSpec(argsJson: string): ParseSpecResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return { ok: false, error: "submit_spec arguments must be valid JSON." };
  }
  return parseSpecPayload(parsed);
}

export function parseSpecPayload(value: unknown): ParseSpecResult {
  if (!isRecord(value)) {
    return { ok: false, error: "submit_spec payload must be an object." };
  }

  const status = value.status;
  if (status !== "executable" && status !== "needs_human_judgment") {
    return {
      ok: false,
      error: 'status must be "executable" or "needs_human_judgment".',
    };
  }

  const spec = parseSpec(value.spec);
  if (!spec.ok) {
    return spec;
  }

  return { ok: true, value: { status, spec: spec.value } };
}

/**
 * Harness-side gate: the model's status field is not trusted alone.
 * Any unresolved requires_human_judgment ambiguity forces escalation,
 * even if the model labeled the spec executable.
 */
export function enforceSpecDecision(raw: {
  status: SpecDecision["status"];
  spec: Spec;
}): SpecDecision {
  const unresolvedJudgment = raw.spec.ambiguities.filter(
    (item) =>
      item.classification === "requires_human_judgment" &&
      item.status === "unresolved",
  );

  if (raw.status === "needs_human_judgment" || unresolvedJudgment.length > 0) {
    const unresolvedQuestions =
      unresolvedJudgment.length > 0
        ? unresolvedJudgment
        : raw.spec.ambiguities.filter((item) => item.status === "unresolved");
    return {
      status: "needs_human_judgment",
      spec: raw.spec,
      unresolvedQuestions,
    };
  }

  return { status: "executable", spec: raw.spec };
}

export function formatSpecContract(task: string, spec: Spec): string {
  return [
    "## Authoritative specification",
    "Implement this contract. Do not invent product behavior beyond it.",
    "",
    JSON.stringify(spec, null, 2),
    "",
    "## Original task (provenance only)",
    task,
  ].join("\n");
}

export function summarizeAmbiguities(spec: Spec): Array<{
  question: string;
  classification: AmbiguityClassification;
  status: AmbiguityStatus;
}> {
  return spec.ambiguities.map((item) => ({
    question: item.question,
    classification: item.classification,
    status: item.status,
  }));
}

export type SpecArtifact = {
  task: string;
  decision: SpecDecision["status"] | null;
  spec: Spec | null;
  unresolvedQuestions: Ambiguity[];
  implementationStarted: boolean;
  workflowStatus: string;
};

export function specArtifactPath(tracePath: string): string {
  return tracePath.replace(/\.jsonl$/, ".spec.json");
}

export function writeSpecArtifact(
  tracePath: string,
  artifact: SpecArtifact,
): string {
  const specPath = specArtifactPath(tracePath);
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return specPath;
}

function parseSpec(
  value: unknown,
): { ok: true; value: Spec } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "spec must be an object." };
  }

  if (typeof value.goal !== "string" || value.goal.trim() === "") {
    return { ok: false, error: "spec.goal must be a non-empty string." };
  }

  const requirements = parseStringArray(
    value.requirements,
    "spec.requirements",
  );
  if (!requirements.ok) return requirements;
  const constraints = parseStringArray(value.constraints, "spec.constraints");
  if (!constraints.ok) return constraints;
  const nonGoals = parseStringArray(value.nonGoals, "spec.nonGoals");
  if (!nonGoals.ok) return nonGoals;
  const acceptance = parseStringArray(value.acceptance, "spec.acceptance");
  if (!acceptance.ok) return acceptance;
  const verification = parseStringArray(
    value.verification,
    "spec.verification",
  );
  if (!verification.ok) return verification;

  if (!Array.isArray(value.ambiguities)) {
    return { ok: false, error: "spec.ambiguities must be an array." };
  }

  const ambiguities: Ambiguity[] = [];
  for (const [index, item] of value.ambiguities.entries()) {
    const parsed = parseAmbiguity(item, index);
    if (!parsed.ok) {
      return parsed;
    }
    ambiguities.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      goal: value.goal,
      requirements: requirements.value,
      constraints: constraints.value,
      nonGoals: nonGoals.value,
      acceptance: acceptance.value,
      verification: verification.value,
      ambiguities,
    },
  };
}

function parseAmbiguity(
  value: unknown,
  index: number,
): { ok: true; value: Ambiguity } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: `spec.ambiguities[${index}] must be an object.`,
    };
  }

  if (typeof value.question !== "string" || value.question.trim() === "") {
    return {
      ok: false,
      error: `spec.ambiguities[${index}].question must be a non-empty string.`,
    };
  }

  const classification = value.classification;
  if (
    classification !== "repository_resolvable" &&
    classification !== "safe_inference" &&
    classification !== "requires_human_judgment"
  ) {
    return {
      ok: false,
      error: `spec.ambiguities[${index}].classification is invalid.`,
    };
  }

  const status = value.status;
  if (status !== "resolved" && status !== "unresolved") {
    return {
      ok: false,
      error: `spec.ambiguities[${index}].status must be "resolved" or "unresolved".`,
    };
  }

  if (typeof value.resolution !== "string") {
    return {
      ok: false,
      error: `spec.ambiguities[${index}].resolution must be a string.`,
    };
  }
  if (typeof value.basis !== "string") {
    return {
      ok: false,
      error: `spec.ambiguities[${index}].basis must be a string.`,
    };
  }

  return {
    ok: true,
    value: {
      question: value.question,
      classification,
      status,
      resolution: value.resolution,
      basis: value.basis,
    },
  };
}

function parseStringArray(
  value: unknown,
  field: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return { ok: false, error: `${field} must be an array of strings.` };
  }
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
