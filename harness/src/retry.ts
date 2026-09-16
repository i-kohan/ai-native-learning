export const DEFAULT_MAX_REVIEW_RETRY_ATTEMPTS = 2;

export type RetryOperationKind = "spec" | "worker" | "verify" | "review";

export type RetryFailureClass =
  | "retryable_transient"
  | "semantic_domain"
  | "permanent_policy"
  | "ambiguous_side_effect";

export type RetryDecision =
  | { action: "retry" }
  | { action: "stop"; reason: string }
  | { action: "needs_reconciliation"; reason: string };

export type DurableRetryState = {
  operationId: string;
  operationKind: RetryOperationKind;
  attemptsStarted: number;
  maxAttempts: number;
  lastFailureClass?: RetryFailureClass;
};

export type ReviewRetryExecutorResult = {
  result: unknown | null;
  failureReason?:
    | "max_turns_exceeded"
    | "model_error"
    | "transient_model_error"
    | "invalid_review";
};

export type ReviewRetryOutcome<T extends ReviewRetryExecutorResult> =
  | {
      status: "completed";
      review: T;
      retry: undefined;
      decision: undefined;
    }
  | {
      status: "paused";
      review: T;
      retry: DurableRetryState;
      decision: Extract<RetryDecision, { action: "retry" }>;
    }
  | {
      status: "failed";
      review: T;
      retry: DurableRetryState;
      decision: Exclude<RetryDecision, { action: "retry" }>;
    };

/**
 * Harness-owned retry admission. The model does not classify, budget, or decide.
 */
export function decideRetry(options: {
  operationKind: RetryOperationKind;
  failureClass: RetryFailureClass;
  attemptsStarted: number;
  maxAttempts: number;
}): RetryDecision {
  if (options.attemptsStarted >= options.maxAttempts) {
    return { action: "stop", reason: "retry_budget_exhausted" };
  }
  if (options.failureClass === "permanent_policy") {
    return { action: "stop", reason: "permanent_policy" };
  }
  if (options.failureClass === "ambiguous_side_effect") {
    return {
      action: "needs_reconciliation",
      reason: `${options.operationKind}_ambiguous_side_effect`,
    };
  }
  if (options.failureClass === "semantic_domain") {
    return { action: "stop", reason: "semantic_domain" };
  }
  return { action: "retry" };
}

export function reviewOperationId(
  workflowId: string,
  logicalReviewId: string,
): string {
  return `${workflowId}:review:${logicalReviewId}`;
}

export function logicalReviewId(
  reviewBaselineArtifactId: string,
  round: number,
): string {
  return `${reviewBaselineArtifactId}:round-${round}`;
}

export function classifyReviewExecutionFailure(
  failureReason: ReviewRetryExecutorResult["failureReason"],
): RetryFailureClass {
  if (failureReason === "transient_model_error") {
    return "retryable_transient";
  }
  if (
    failureReason === "invalid_review" ||
    failureReason === "max_turns_exceeded"
  ) {
    return "semantic_domain";
  }
  return "permanent_policy";
}

export function classifyCaughtReviewError(
  error: unknown,
): "transient_model_error" | "model_error" {
  const status = errorStatus(error);
  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return "transient_model_error";
  }
  const message = errorMessage(error).toLowerCase();
  if (
    /econnreset|etimedout|econnrefused|enotfound|socket hang up|timeout|429|503|502|504|rate limit|overloaded|temporarily unavailable|connection reset/.test(
      message,
    )
  ) {
    return "transient_model_error";
  }
  return "model_error";
}

export function startRetryAttempt(options: {
  current: DurableRetryState | undefined;
  operationId: string;
  operationKind: RetryOperationKind;
  maxAttempts: number;
}): DurableRetryState {
  const current = options.current;
  if (
    current &&
    current.operationId === options.operationId &&
    current.operationKind === options.operationKind
  ) {
    return {
      operationId: current.operationId,
      operationKind: current.operationKind,
      attemptsStarted: current.attemptsStarted + 1,
      maxAttempts: current.maxAttempts,
      ...(current.lastFailureClass
        ? { lastFailureClass: current.lastFailureClass }
        : {}),
    };
  }
  return {
    operationId: options.operationId,
    operationKind: options.operationKind,
    attemptsStarted: 1,
    maxAttempts: options.maxAttempts,
  };
}

export function recordRetryFailure(
  current: DurableRetryState,
  failureClass: RetryFailureClass,
): DurableRetryState {
  return {
    ...current,
    lastFailureClass: failureClass,
  };
}

export function parseDurableRetryState(
  value: unknown,
): { ok: true; value: DurableRetryState } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "retry must be an object." };
  }
  const operationId = parseNonEmptyString(
    value.operationId,
    "retry.operationId",
  );
  if (!operationId.ok) {
    return operationId;
  }
  const operationKind = value.operationKind;
  if (!isRetryOperationKind(operationKind)) {
    return {
      ok: false,
      error: `retry.operationKind is invalid: ${String(operationKind)}.`,
    };
  }
  const attemptsStarted = parseIntegerAtLeast(
    value.attemptsStarted,
    "retry.attemptsStarted",
    1,
  );
  if (!attemptsStarted.ok) {
    return attemptsStarted;
  }
  const maxAttempts = parseIntegerAtLeast(
    value.maxAttempts,
    "retry.maxAttempts",
    1,
  );
  if (!maxAttempts.ok) {
    return maxAttempts;
  }
  const lastFailureClass = value.lastFailureClass;
  if (
    lastFailureClass !== undefined &&
    !isRetryFailureClass(lastFailureClass)
  ) {
    return {
      ok: false,
      error: `retry.lastFailureClass is invalid: ${String(lastFailureClass)}.`,
    };
  }
  return {
    ok: true,
    value: {
      operationId: operationId.value,
      operationKind,
      attemptsStarted: attemptsStarted.value,
      maxAttempts: maxAttempts.value,
      ...(lastFailureClass !== undefined ? { lastFailureClass } : {}),
    },
  };
}

export async function executeReviewWithRetry<
  T extends ReviewRetryExecutorResult,
>(options: {
  operationId: string;
  currentRetry: DurableRetryState | undefined;
  maxAttempts?: number;
  injectTransientOnAttempt?: number;
  stopAfterRetryAdmission?: boolean;
  persistRetry: (retry: DurableRetryState) => void;
  runReview: () => Promise<T>;
  onAttemptStarted?: (retry: DurableRetryState) => void;
  onInjectedFailure?: (retry: DurableRetryState) => void;
  onClassified?: (input: {
    retry: DurableRetryState;
    failureClass: RetryFailureClass;
    decision: RetryDecision;
  }) => void;
}): Promise<ReviewRetryOutcome<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_REVIEW_RETRY_ATTEMPTS;
  let retry = sameRetryOperation(options.currentRetry, options.operationId);

  while (true) {
    const admission = admitNextReviewAttempt(retry, maxAttempts);
    if (admission.action !== "retry") {
      if (!retry) {
        throw new Error(
          "RetryPolicy refused admission without durable retry state.",
        );
      }
      return {
        status: "failed",
        review: failedReviewStub<T>(retry.lastFailureClass),
        retry,
        decision: admission,
      };
    }

    const started = startRetryAttempt({
      current: retry,
      operationId: options.operationId,
      operationKind: "review",
      maxAttempts,
    });
    options.persistRetry(started);
    options.onAttemptStarted?.(started);

    const injected =
      options.injectTransientOnAttempt === started.attemptsStarted;
    let review: T;
    if (injected) {
      options.onInjectedFailure?.(started);
      review = {
        result: null,
        failureReason: "transient_model_error",
      } as T;
    } else {
      review = await options.runReview();
    }

    if (review.result) {
      return {
        status: "completed",
        review,
        retry: undefined,
        decision: undefined,
      };
    }

    const failureClass = classifyReviewExecutionFailure(review.failureReason);
    const recorded = recordRetryFailure(started, failureClass);
    options.persistRetry(recorded);
    retry = recorded;

    const decision = decideRetry({
      operationKind: "review",
      failureClass,
      attemptsStarted: recorded.attemptsStarted,
      maxAttempts: recorded.maxAttempts,
    });
    options.onClassified?.({ retry: recorded, failureClass, decision });

    if (decision.action === "retry") {
      if (options.stopAfterRetryAdmission) {
        return {
          status: "paused",
          review,
          retry: recorded,
          decision,
        };
      }
      continue;
    }

    return {
      status: "failed",
      review,
      retry: recorded,
      decision,
    };
  }
}

function admitNextReviewAttempt(
  retry: DurableRetryState | undefined,
  maxAttempts: number,
): RetryDecision {
  if (!retry) {
    return { action: "retry" };
  }
  return decideRetry({
    operationKind: retry.operationKind,
    failureClass: retry.lastFailureClass ?? "retryable_transient",
    attemptsStarted: retry.attemptsStarted,
    maxAttempts: retry.maxAttempts ?? maxAttempts,
  });
}

function sameRetryOperation(
  current: DurableRetryState | undefined,
  operationId: string,
): DurableRetryState | undefined {
  if (!current || current.operationId !== operationId) {
    return undefined;
  }
  return current;
}

function failedReviewStub<T extends ReviewRetryExecutorResult>(
  failureClass: RetryFailureClass | undefined,
): T {
  return {
    result: null,
    failureReason:
      failureClass === "retryable_transient"
        ? "transient_model_error"
        : "invalid_review",
  } as T;
}

function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  if (typeof error.status === "number") {
    return error.status;
  }
  if (typeof error.statusCode === "number") {
    return error.statusCode;
  }
  if (isRecord(error.cause)) {
    return errorStatus(error.cause);
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRetryOperationKind(value: unknown): value is RetryOperationKind {
  return (
    value === "spec" ||
    value === "worker" ||
    value === "verify" ||
    value === "review"
  );
}

function isRetryFailureClass(value: unknown): value is RetryFailureClass {
  return (
    value === "retryable_transient" ||
    value === "semantic_domain" ||
    value === "permanent_policy" ||
    value === "ambiguous_side_effect"
  );
}

function parseIntegerAtLeast(
  value: unknown,
  field: string,
  min: number,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    return { ok: false, error: `${field} must be an integer >= ${min}.` };
  }
  return { ok: true, value };
}

function parseNonEmptyString(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: `${field} must be a non-empty string.` };
  }
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
