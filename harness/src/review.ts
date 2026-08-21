import type { TokenUsageSummary } from "./context.ts";
import type { Spec } from "./spec.ts";

export const DEFAULT_MAX_REVIEW_REPAIR_ATTEMPTS = 1;

export const FINDING_CATEGORIES = [
  "architecture",
  "correctness",
  "maintainability",
  "scope",
  "security",
  "compatibility",
] as const;

export const FINDING_SEVERITIES = ["high", "medium", "low"] as const;
export const FINDING_CONFIDENCES = ["high", "medium", "low"] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

export type RelatedAuthority = {
  type: "spec_requirement" | "architecture_constraint";
  id: string;
};

export type Finding = {
  findingKey: string;
  category: FindingCategory;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  description: string;
  evidence: string[];
  relatedAuthority?: RelatedAuthority;
};

export type ReviewResult = {
  status: "pass" | "findings";
  findings: Finding[];
};

export type ArchitectureConstraint = {
  id: string;
  text: string;
};

export type CompactVerificationEvidence = {
  passed: boolean;
  exitCode: number;
  durationMs: number;
  attempt: number;
};

export type ReviewContext = {
  spec: Spec;
  unifiedDiff: string;
  changedFiles: string[];
  architectureConstraints: ArchitectureConstraint[];
  verificationEvidence: CompactVerificationEvidence;
};

export type FindingDecisionKind =
  | "accepted_blocking"
  | "accepted_non_blocking"
  | "rejected";

export type FindingDecisionRecord = {
  finding: Finding;
  decision: FindingDecisionKind;
  reason: string;
};

export type ReviewAttemptSummary = {
  round: number;
  status: ReviewResult["status"];
  findings: Finding[];
  decisions: FindingDecisionRecord[];
  modelCalls: number;
  toolCalls: number;
  durationMs: number;
  parseOk: boolean;
  tokenUsage: TokenUsageSummary | null;
};

export type ReviewRepairSummary = {
  attempt: number;
  modelCalls: number;
  toolCalls: number;
  turns: number;
  receivedTerminalResponse: boolean;
  changedFiles: string[];
  durationMs: number;
  tokenUsage: TokenUsageSummary | null;
};

export type FinalReviewerOutcome =
  | "pass"
  | "findings_unresolved"
  | "skipped"
  | "parse_failed";

export type ReviewRunState = {
  reviewAttempts: number;
  reviews: ReviewAttemptSummary[];
  reviewRepairAttempts: number;
  reviewRepairs: ReviewRepairSummary[];
  repeatedFinding: boolean;
  intendedFindingDetected: boolean;
  acceptedBlockingFindings: FindingDecisionRecord[];
  acceptedNonBlockingFindings: FindingDecisionRecord[];
  rejectedFindings: FindingDecisionRecord[];
  blockingFalsePositives: FindingDecisionRecord[];
  finalReviewerOutcome: FinalReviewerOutcome;
};

export type ReviewLoopDecision =
  | { action: "success" }
  | { action: "review_repair"; attempt: number }
  | {
      action: "stop";
      reason:
        | "max_review_repair_attempts"
        | "review2_blocker"
        | "repeated_finding";
      repeatedFinding: boolean;
    };

export const ARCH_01: ArchitectureConstraint = {
  id: "ARCH-01",
  text: "Task state transitions must be owned by TaskService. Route handlers may validate/map HTTP requests and delegate to TaskService, but must not directly mutate Task.status or Task.completedAt.",
};

export const INTENDED_ARCH01_FINDING_KEY =
  "task-state-transition-outside-service";

export const SUBMIT_REVIEW_TOOL = {
  type: "function" as const,
  name: "submit_review",
  description:
    "Submit the structured independent review result. Do not implement. Do not prescribe an exact fix.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["pass", "findings"],
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            findingKey: { type: "string" },
            category: {
              type: "string",
              enum: [...FINDING_CATEGORIES],
            },
            severity: {
              type: "string",
              enum: [...FINDING_SEVERITIES],
            },
            confidence: {
              type: "string",
              enum: [...FINDING_CONFIDENCES],
            },
            description: { type: "string" },
            evidence: {
              type: "array",
              items: { type: "string" },
            },
            relatedAuthority: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["spec_requirement", "architecture_constraint"],
                },
                id: { type: "string" },
              },
              required: ["type", "id"],
              additionalProperties: false,
            },
          },
          required: [
            "findingKey",
            "category",
            "severity",
            "confidence",
            "description",
            "evidence",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["status", "findings"],
    additionalProperties: false,
  },
};

export type ParseReviewResult =
  | { ok: true; value: ReviewResult }
  | { ok: false; error: string };

export function parseSubmitReview(argsJson: string): ParseReviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return { ok: false, error: "submit_review arguments must be valid JSON." };
  }
  return parseReviewPayload(parsed);
}

export function parseReviewPayload(value: unknown): ParseReviewResult {
  if (!isRecord(value)) {
    return { ok: false, error: "review payload must be an object." };
  }

  const status = value.status;
  if (status !== "pass" && status !== "findings") {
    return { ok: false, error: 'status must be "pass" or "findings".' };
  }

  if (!Array.isArray(value.findings)) {
    return { ok: false, error: "findings must be an array." };
  }

  const findings: Finding[] = [];
  for (const [index, item] of value.findings.entries()) {
    const parsed = parseFinding(item, index);
    if (!parsed.ok) {
      return parsed;
    }
    findings.push(parsed.value);
  }

  if (status === "findings" && findings.length === 0) {
    return {
      ok: false,
      error: 'status "findings" requires at least one finding.',
    };
  }

  if (status === "pass" && findings.length > 0) {
    return {
      ok: false,
      error: 'status "pass" requires findings to be empty.',
    };
  }

  return { ok: true, value: { status, findings } };
}

export function shouldStartReview(
  deterministicVerificationPassed: boolean,
): boolean {
  return deterministicVerificationPassed;
}

export function decideFinding(
  finding: Finding,
  context: Pick<
    ReviewContext,
    "spec" | "changedFiles" | "architectureConstraints" | "verificationEvidence"
  >,
): FindingDecisionRecord {
  if (!hasConcreteEvidence(finding)) {
    return record(finding, "rejected", "unsupported");
  }

  const specConflict = specConflictReason(finding, context.spec);
  if (specConflict) {
    return record(finding, "rejected", specConflict);
  }

  if (!isInScope(finding, context)) {
    return record(finding, "rejected", "out_of_scope");
  }

  if (!isActionable(finding)) {
    return record(finding, "rejected", "not_actionable");
  }

  if (finding.confidence === "low") {
    return record(finding, "accepted_non_blocking", "low_confidence");
  }

  if (finding.severity === "low") {
    return record(finding, "accepted_non_blocking", "low_severity");
  }

  return record(finding, "accepted_blocking", "blocking");
}

export function nextReviewDecision(state: {
  reviewRound: number;
  acceptedBlockingKeys: string[];
  previousBlockingKeys: string[];
  reviewRepairAttemptsUsed: number;
  maxReviewRepairAttempts: number;
}): ReviewLoopDecision {
  if (state.acceptedBlockingKeys.length === 0) {
    return { action: "success" };
  }

  const repeatedFinding = state.acceptedBlockingKeys.some((key) =>
    state.previousBlockingKeys.includes(key),
  );

  if (state.reviewRound >= 2) {
    return {
      action: "stop",
      reason: repeatedFinding ? "repeated_finding" : "review2_blocker",
      repeatedFinding,
    };
  }

  if (state.reviewRepairAttemptsUsed >= state.maxReviewRepairAttempts) {
    return {
      action: "stop",
      reason: "max_review_repair_attempts",
      repeatedFinding,
    };
  }

  return {
    action: "review_repair",
    attempt: state.reviewRepairAttemptsUsed + 1,
  };
}

export function isIntendedArch01Finding(finding: Finding): boolean {
  const blob = [
    finding.findingKey,
    finding.description,
    finding.evidence.join("\n"),
    finding.relatedAuthority?.id ?? "",
    finding.relatedAuthority?.type ?? "",
  ].join("\n");

  const architecture = finding.category === "architecture";
  const refsArch01 =
    finding.relatedAuthority?.id === "ARCH-01" || /ARCH-01/i.test(blob);
  const concrete =
    /task-routes|completeTask|completedAt|Task\.status|\.status\s*=/i.test(
      blob,
    );
  return architecture && refsArch01 && concrete && hasConcreteEvidence(finding);
}

export function formatReviewContext(context: ReviewContext): string {
  const constraints =
    context.architectureConstraints.length > 0
      ? context.architectureConstraints
          .map((item) => `${item.id}:\n${item.text}`)
          .join("\n\n")
      : "(none supplied)";

  const diff =
    context.unifiedDiff.trim() ||
    "(no source changes from the original snapshot)";

  return [
    "## Independent review",
    "You did not implement this change.",
    "Treat the resolved spec and supplied architecture constraints as authoritative.",
    "Do not redesign product requirements.",
    "Do not invent new architecture rules.",
    "Deterministic tests already passed; you do not replace tests.",
    "Do not restate architecture/layering issues as observable correctness failures.",
    "Report WHAT is wrong, WHERE (evidence), WHY it matters, and which supplied authority it relates to.",
    "Do not prescribe an exact implementation fix.",
    "Do not include suggestedFix, an implementation plan, or a numeric probability.",
    "",
    "## Authoritative resolved spec",
    JSON.stringify(context.spec, null, 2),
    "",
    "## Architecture constraints (authoritative)",
    constraints,
    "",
    "## Current unified diff (from original pre-task snapshot)",
    diff,
    "",
    "## Compact deterministic verification evidence",
    JSON.stringify(context.verificationEvidence, null, 2),
    "",
    "Call submit_review with status pass or findings.",
  ].join("\n");
}

export function formatReviewRepairContract(
  originalTask: string,
  spec: Spec,
  acceptedBlockers: Finding[],
): string {
  return [
    "## Authoritative specification",
    "This resolved spec remains the execution contract. Do not invent product behavior beyond it.",
    "",
    JSON.stringify(spec, null, 2),
    "",
    "## Accepted blocking review findings",
    "The harness accepted these independent-review findings as blockers.",
    "They describe problems and evidence. They do not prescribe the implementation fix.",
    "Reason independently about HOW to fix the accepted problems.",
    "",
    JSON.stringify(
      acceptedBlockers.map((finding) => ({
        findingKey: finding.findingKey,
        category: finding.category,
        severity: finding.severity,
        description: finding.description,
        evidence: finding.evidence,
        relatedAuthority: finding.relatedAuthority ?? null,
      })),
      null,
      2,
    ),
    "",
    "## Repair",
    "This episode repairs the current implementation from the accepted findings above.",
    "Do not modify tests, spec, verifier, or harness.",
    "When the repair is complete, stop calling tools and reply with a short summary.",
    "",
    "## Original task (provenance only)",
    originalTask,
  ].join("\n");
}

export function emptyReviewRunState(): ReviewRunState {
  return {
    reviewAttempts: 0,
    reviews: [],
    reviewRepairAttempts: 0,
    reviewRepairs: [],
    repeatedFinding: false,
    intendedFindingDetected: false,
    acceptedBlockingFindings: [],
    acceptedNonBlockingFindings: [],
    rejectedFindings: [],
    blockingFalsePositives: [],
    finalReviewerOutcome: "skipped",
  };
}

export function aggregateReviewState(
  reviews: ReviewAttemptSummary[],
): Pick<
  ReviewRunState,
  | "intendedFindingDetected"
  | "acceptedBlockingFindings"
  | "acceptedNonBlockingFindings"
  | "rejectedFindings"
  | "blockingFalsePositives"
> {
  const first = reviews[0];
  const intendedFindingDetected = Boolean(
    first?.decisions.some(
      (item) =>
        item.decision === "accepted_blocking" &&
        isIntendedArch01Finding(item.finding),
    ),
  );

  const acceptedBlockingFindings = flattenDecisions(
    reviews,
    "accepted_blocking",
  );
  const acceptedNonBlockingFindings = flattenDecisions(
    reviews,
    "accepted_non_blocking",
  );
  const rejectedFindings = flattenDecisions(reviews, "rejected");
  const blockingFalsePositives = acceptedBlockingFindings.filter(
    (item) => !isIntendedArch01Finding(item.finding),
  );

  return {
    intendedFindingDetected,
    acceptedBlockingFindings,
    acceptedNonBlockingFindings,
    rejectedFindings,
    blockingFalsePositives,
  };
}

function flattenDecisions(
  reviews: ReviewAttemptSummary[],
  decision: FindingDecisionKind,
): FindingDecisionRecord[] {
  return reviews.flatMap((review) =>
    review.decisions.filter((item) => item.decision === decision),
  );
}

function parseFinding(
  value: unknown,
  index: number,
): { ok: true; value: Finding } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: `findings[${index}] must be an object.` };
  }

  if (typeof value.findingKey !== "string" || value.findingKey.trim() === "") {
    return {
      ok: false,
      error: `findings[${index}].findingKey must be a non-empty string.`,
    };
  }
  if (!isAllowed(value.category, FINDING_CATEGORIES)) {
    return { ok: false, error: `findings[${index}].category is invalid.` };
  }
  if (!isAllowed(value.severity, FINDING_SEVERITIES)) {
    return { ok: false, error: `findings[${index}].severity is invalid.` };
  }
  if (!isAllowed(value.confidence, FINDING_CONFIDENCES)) {
    return { ok: false, error: `findings[${index}].confidence is invalid.` };
  }
  if (
    typeof value.description !== "string" ||
    value.description.trim() === ""
  ) {
    return {
      ok: false,
      error: `findings[${index}].description must be a non-empty string.`,
    };
  }
  if (
    !Array.isArray(value.evidence) ||
    !value.evidence.every((item) => typeof item === "string")
  ) {
    return {
      ok: false,
      error: `findings[${index}].evidence must be an array of strings.`,
    };
  }

  let relatedAuthority: RelatedAuthority | undefined;
  if (value.relatedAuthority !== undefined) {
    if (!isRecord(value.relatedAuthority)) {
      return {
        ok: false,
        error: `findings[${index}].relatedAuthority must be an object.`,
      };
    }
    const authorityType = value.relatedAuthority.type;
    if (
      authorityType !== "spec_requirement" &&
      authorityType !== "architecture_constraint"
    ) {
      return {
        ok: false,
        error: `findings[${index}].relatedAuthority.type is invalid.`,
      };
    }
    if (
      typeof value.relatedAuthority.id !== "string" ||
      value.relatedAuthority.id.trim() === ""
    ) {
      return {
        ok: false,
        error: `findings[${index}].relatedAuthority.id must be a non-empty string.`,
      };
    }
    relatedAuthority = {
      type: authorityType,
      id: value.relatedAuthority.id,
    };
  }

  return {
    ok: true,
    value: {
      findingKey: value.findingKey,
      category: value.category,
      severity: value.severity,
      confidence: value.confidence,
      description: value.description,
      evidence: value.evidence,
      ...(relatedAuthority ? { relatedAuthority } : {}),
    },
  };
}

function hasConcreteEvidence(finding: Finding): boolean {
  return finding.evidence.some((item) => item.trim().length > 0);
}

function isActionable(finding: Finding): boolean {
  return (
    finding.description.trim().length > 0 &&
    hasConcreteEvidence(finding) &&
    Boolean(
      finding.relatedAuthority ||
      /task-routes|task-service|completeTask|\.ts\b/i.test(
        `${finding.description}\n${finding.evidence.join("\n")}`,
      ),
    )
  );
}

function isInScope(
  finding: Finding,
  context: Pick<
    ReviewContext,
    "spec" | "changedFiles" | "architectureConstraints"
  >,
): boolean {
  if (finding.relatedAuthority?.type === "architecture_constraint") {
    return context.architectureConstraints.some(
      (item) => item.id === finding.relatedAuthority?.id,
    );
  }

  if (finding.relatedAuthority?.type === "spec_requirement") {
    return specAuthorityExists(finding.relatedAuthority.id, context.spec);
  }

  const blob =
    `${finding.description}\n${finding.evidence.join("\n")}`.toLowerCase();
  return context.changedFiles.some((file) => {
    const normalized = file.replace(/\\/g, "/").toLowerCase();
    const base = normalized.split("/").pop() ?? normalized;
    return blob.includes(normalized) || blob.includes(base);
  });
}

function specConflictReason(finding: Finding, spec: Spec): string | null {
  if (finding.relatedAuthority?.type !== "spec_requirement") {
    return null;
  }
  if (!specAuthorityExists(finding.relatedAuthority.id, spec)) {
    return "spec_conflict";
  }
  return null;
}

function specAuthorityExists(id: string, spec: Spec): boolean {
  const needle = id.trim().toLowerCase();
  if (!needle) {
    return false;
  }
  const corpus = [
    spec.goal,
    ...spec.requirements,
    ...spec.acceptance,
    ...spec.constraints,
  ]
    .join("\n")
    .toLowerCase();
  return corpus.includes(needle);
}

function record(
  finding: Finding,
  decision: FindingDecisionKind,
  reason: string,
): FindingDecisionRecord {
  return { finding, decision, reason };
}

function isAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
