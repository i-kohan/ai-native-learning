# 18 — Retry Semantics

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-17 after implementation review, RET01, regression review, and the retry-semantics understanding checks.

## Mental model

Retry answers a different question than resume or repair:

```text
Resume  = dispatch from a committed checkpoint
Retry   = may this failed/unknown attempt be started again?
Repair  = a new semantic episode after real evidence of domain failure
```

The outer harness owns classification, budget, and admission. The model executes a bounded attempt. It does not decide whether another attempt is allowed.

## Failure classes

```text
retryable_transient
  execution/provider failure; no successful semantic result received

semantic_domain
  the operation ran and produced a real domain failure
  VERIFY tests failed, REVIEW returned a blocker, invalid review payload
  → existing repair / workflow handling, not retry

permanent_policy
  another attempt cannot make this legal
  → stop

ambiguous_side_effect
  the attempt may have mutated external state, and the outcome is unknown
  → needs_reconciliation / fail closed
  → never blind retry
```

## Retry-safe vs mutating work

A **retry-safe** operation can be started again without corrupting authority. Independent REVIEW is retry-safe here: it judges an already committed artifact and does not mutate the workspace.

**Idempotency** would mean a second attempt cannot change the meaning of the first. REVIEW does not need a generic idempotency platform because a duplicate review of the same artifact is safe.

**Reconciliation** is required when a mutating Worker may have done unknown work. The current harness does not reconcile Worker side effects. Workspace fingerprint mismatch still fails closed.

## Stable identity and durable budget

Attempts of one logical REVIEW share one `operationId`:

```text
<workflow-id>:review:<baseline-artifact-id>:round-<n>
```

`attemptsStarted` is persisted **before** the attempt begins. A crash after persist still consumed the budget.

Retry state stays on `review_ready` until the next durable semantic boundary:

```text
terminal persisted
→ retry field gone with the phase

or

new logical REVIEW round
→ new operationId replaces the old retry record
```

A valid in-memory REVIEW result does **not** clear the durable budget by itself. Otherwise a crash before terminal would reset `attemptsStarted` to a fresh attempt 1.

Unknown `model_error` is not automatically transient. Only an explicit `transient_model_error` (timeout, 503, connection reset, and similar) is `retryable_transient`.

This is a bounded durable budget. It is not exactly-once delivery or exactly-once execution.

## What this module proves

```text
review_ready
→ REVIEW attempt 1
→ injected transient provider failure
→ harness classifies retryable_transient
→ RetryPolicy admits retry
→ REVIEW attempt 2
→ PASS
→ terminal
```

And:

```text
worker + ambiguous_side_effect
→ needs_reconciliation
→ never action: retry
```

## Explicit limitation

The current harness demonstrates bounded durable retry for a safe REVIEW operation.

It does **not** make arbitrary mutating Worker execution retry-safe.

It does **not** provide exactly-once semantics.

## Takeaways

1. Retry ≠ resume ≠ repair.
2. Classification, budget, and admission stay in the harness.
3. Count attempts before execution so a crash cannot reset the budget.
4. Retry-safe work may be retried; ambiguous mutation must reconcile or fail closed.
5. A successful semantic result is required to advance; a lost result is not success.
6. Unknown model errors fail closed; only known transient provider/execution failures retry.

## Closure

Module 18 is closed at the intended learning frontier:

```text
harness-owned bounded retry policy       = implemented
REVIEW durable retry across restart      = demonstrated by RET01
stable logical operation identity        = demonstrated
attempt budget survives process restart  = demonstrated
unsafe Worker blind retry                = explicitly rejected
retry / resume / repair boundaries       = understood
exactly-once / Worker reconciliation      = intentionally out of scope
```

See `closure.md` for the closure record and evidence references.
