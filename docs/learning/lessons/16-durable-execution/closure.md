# Module 16 — Durable Execution — Master Closure

**Status:** ✅ FORMALLY CLOSED BY MASTER on 2026-09-11.

## Accepted result

Module 16 established one bounded durable outer-workflow checkpoint:

```text
spec_required
→ harness admits executable Spec
→ persist implementation_ready
→ process boundary / restart
→ load authoritative WorkflowState
→ validate and reuse the same workspace
→ skip completed Spec
→ Worker → VERIFY → independent REVIEW
→ persist terminal
```

DUR01 is accepted as a mechanism proof for this checkpoint, not as a production workflow-engine claim.

## Evidence accepted

Hardened DUR01 rerun:

- uninterrupted control: success;
- interrupted process A persisted `implementation_ready`;
- process B was a fresh process/invocation;
- same workflow ID and same workspace/base were reused;
- resumed process recorded `specModelCalls=0` / Spec skipped;
- Worker ran;
- VERIFY = PASS;
- independent REVIEW = pass;
- terminal state persisted;
- all executable DUR01 assertions passed.

Evidence:

`docs/learning/lessons/16-durable-execution/traces/DUR01-durable-2026-09-11T15-17-19-208Z.txt`

Harness unit tests at Topic closure: 191 passed.

## Authority model accepted

- `WorkflowState`, not trace history or model conversation state, is current durable workflow authority.
- model/executor produces a result; harness admits legal transition; store commits the next state.
- `spec_required → terminal(success)` is illegal; successful terminal outcome remains downstream of admitted executable Spec and implementation/verification path.
- workflow owns the resumable workspace; one Node process is only a temporary executor.

## Scope boundary

Module 16 proves only the first safe checkpoint before the first mutating Worker phase.

It intentionally does not solve:

- mid-Worker crash recovery;
- replay/idempotency of mutating activities;
- reconciliation of partially applied side effects;
- generalized multi-checkpoint resume;
- retry taxonomy;
- leases / ownership / stale-worker fencing;
- distributed workflow execution.

These are later Phase-4 topics.

## Next module

**17 — Checkpoint / Resume**

Main next question:

> Once the workflow has multiple meaningful durable boundaries, how do we checkpoint enough semantic state to resume from the latest safe point without rerunning already-admitted work or pretending partially applied side effects are complete?
