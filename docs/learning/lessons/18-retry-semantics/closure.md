# Module 18 — Retry Semantics — Closure

**Status:** ✅ FORMALLY CLOSED BY TOPIC CHAT on 2026-09-17 and accepted by Master.

## Closure basis

Module 18 reached its intended learning frontier without expanding into distributed orchestration.

Accepted implementation/evidence:

- harness-owned retry classification, budget, and admission;
- durable REVIEW retry state on `review_ready`;
- `attemptsStarted` persisted before each admitted attempt;
- stable logical `operationId` shared across retry attempts;
- retry budget retained until the next durable semantic boundary;
- known transient provider/execution failures may retry within budget;
- generic/unknown model errors fail closed rather than being assumed transient;
- VERIFY semantic/test failure remains repair semantics, not retry semantics;
- Worker `ambiguous_side_effect` returns `needs_reconciliation`, never blind retry.

## RET01

Recorded evidence:

`docs/learning/lessons/18-retry-semantics/traces/RET01-retry-2026-09-16T21-16-22-470Z.txt`

RET01 demonstrated:

```text
review_ready
→ REVIEW attempt 1
→ explicit transient_model_error
→ harness classifies retryable_transient
→ harness admits retry
→ fresh process
→ REVIEW attempt 2 with same operationId
→ PASS
→ terminal persisted
```

Decision-rule assertions all passed, including:

- same workflow identity;
- same authoritative `review_ready` artifact;
- durable attempt advancement;
- fresh process for attempt 2;
- no Worker rerun;
- no pre-review VERIFY rerun;
- independent REVIEW not bypassed;
- same logical `operationId` across attempts;
- terminal persisted.

Harness unit/regression suite at closure: **221 passed**, including Module 17 checkpoint tests and the retry crash-window regression.

## Review hardening before closure

Topic Chat review found and resolved three gaps before closure:

1. successful in-memory REVIEW no longer clears durable retry state before the next semantic checkpoint;
2. unknown `model_error` is no longer classified as transient by default;
3. RET01 now explicitly proves stable logical operation identity across attempts.

## Scope boundary

Not provided by this module:

- Worker side-effect reconciliation;
- exactly-once execution/delivery;
- leases, heartbeats, fencing, or multi-process ownership;
- distributed queue/scheduler semantics;
- generic external idempotency infrastructure;
- broad retry execution for every phase.

Those omissions are intentional and are not closure blockers.

## Final model

```text
Resume = continue from an authoritative committed checkpoint.
Retry  = harness decides whether the same logical operation may get another attempt.
Repair = change the artifact after known semantic failure.

safe/read-only + known transient + budget → retry may be admitted
semantic/domain failure                  → repair / workflow handling
permanent/policy failure                 → stop
unknown mutating side effects            → reconcile or fail closed
```

## Master acceptance

Master accepts the module because the executable mechanism matches the learned semantics:

- retry admission is outside the model;
- retry state survives process boundaries;
- budget is consumed before execution, preventing restart-based budget reset;
- the probe demonstrates the same logical operation across attempts;
- semantic/domain failure is not mislabeled as retry;
- unsafe mutating work remains explicitly unresolved instead of being made retryable by assumption.

The result is intentionally narrow: **bounded durable retry for a retry-safe REVIEW operation**, not a generic retry platform.

**Module 18 is complete. Next roadmap module: 19 — Orchestration as Distributed Systems.**
