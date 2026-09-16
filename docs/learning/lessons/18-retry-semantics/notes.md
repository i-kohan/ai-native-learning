# 18 — Retry Semantics

Практический журнал Module 18. Формальное закрытие остаётся Topic Chat.

**Status:** implemented and measured. RET01 **passed**. Not marked complete; Topic Chat owns formal closure.

## Что построили

Bounded durable retry only around independent REVIEW:

```text
review_ready
→ persist attemptsStarted = 1
→ REVIEW attempt 1
→ injected retryable_transient
→ harness RetryPolicy admits retry
→ fresh process
→ persist attemptsStarted = 2
→ REVIEW attempt 2 PASS
→ terminal
```

Policy understands `spec | worker | verify | review`, but only REVIEW has an execution path.

## Learning-critical files

1. `harness/src/retry.ts` — taxonomy, `decideRetry`, `executeReviewWithRetry`.
2. `harness/src/workflow-state.ts` — optional `review_ready.retry`.
3. `harness/src/run.ts` — persist attempt before REVIEW; retry remains until terminal or a new `operationId`.
4. `harness/src/retry-probe.ts` — RET01 processes A/B/C.
5. `harness/tests/retry.test.ts` — policy, persist-before-start, crash-window budget, Worker fail-closed.

## Schema

```ts
retry?: {
  operationId: string;
  operationKind: "review";
  attemptsStarted: number;
  maxAttempts: number;
  lastFailureClass?: RetryFailureClass;
}
```

`operationId = ${workflowId}:review:${baselineArtifactId}:round-${round}`.

## Policy

| Input | Decision |
| --- | --- |
| `attemptsStarted >= maxAttempts` | `stop` |
| `permanent_policy` | `stop` |
| `ambiguous_side_effect` | `needs_reconciliation` |
| `semantic_domain` | `stop` |
| `retryable_transient` and budget remains | `retry` |

REVIEW known `transient_model_error` (503, timeout, connection reset) → `retryable_transient`. Generic/unknown `model_error` → `permanent_policy` / fail closed. VERIFY test failure remains repair, not retry. `maxAttempts` for REVIEW = 2.

## RET01 recorded run (2026-09-16)

Command: `npm run benchmark:ret01`

Task: T02 DEV. A stops at `review_ready`. B injects an explicit `transient_model_error` on attempt 1 and pauses after harness retry admission. C resumes in a fresh process and completes REVIEW.

| Arm | pid | start → exit | Worker | pre-review VERIFY | REVIEW | retry |
| --- | ---: | --- | --- | --- | --- | --- |
| A | 43624 | spec_required → review_ready | yes | PASS | skipped | none |
| B | 45299 | review_ready → review_ready | skipped | skipped | attempt 1 injected transient | attemptsStarted=1, decision=retry |
| C | 45311 | review_ready → terminal | skipped | skipped | attempt 2 pass | same operationId; terminal replaces retry |

Same workflow ID. Distinct PIDs. `operationId` stayed `…:review:…review-baseline:round-1` across B and C (`sameLogicalOperationId=yes`). Worker started once (A only).

Evidence: `docs/learning/lessons/18-retry-semantics/traces/RET01-retry-2026-09-16T21-16-22-470Z.txt`

Harness unit tests: **221 passed**, including Module 17 checkpoint tests, crash-window budget retention, and Worker `ambiguous_side_effect → needs_reconciliation`.

## Commands

```bash
cd harness && npm test
cd harness && npm run benchmark:ret01
```

## Non-goals kept out

No Worker reconciliation, leases, exactly-once, backoff platform, or generic retry for every phase.
