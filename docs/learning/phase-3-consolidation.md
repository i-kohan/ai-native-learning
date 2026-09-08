# Phase 3 Consolidation Checkpoint

Date: 2026-09-08

Status: **completed by Master after Module 15**.

## Roadmap state

Modules 01–15 are completed.

Module 15 — Stronger Eval Methodology — is formally accepted by Master after the requested methodology hardening:

- full H01/H02 workflow outcome is part of the executable qualification rule;
- independent grader remains a separate criterion;
- one exact base revision and configured model are pinned across qualification;
- mixed/missing provenance invalidates qualification evidence;
- qualification denominator wording was corrected;
- the original 2026-09-07 qualification artifact remains unchanged and valid for its workload-bounded claim.

Next module: **16 — Durable Execution**.

Do not reopen Module 15 because `progress.md` may still contain stale pre-closure wording. That is bookkeeping debt only.

## Consolidation result

The default architecture remains:

```text
raw task
→ targeted context
→ Spec / ambiguity gate
→ one Worker
→ deterministic VERIFY / bounded repair
→ independent REVIEW / bounded review repair
→ measured outcome
```

No additional Planner/Subagent/decomposition mechanism is promoted to the normal path.

Detailed architecture snapshot:

`docs/architecture/harness-architecture.md`

## Experimental seams retained

Retain, but keep OFF / non-default:

- `previous_response_id` continuation;
- explicit read-only Planner;
- bounded research Subagent;
- human-reviewable decomposition / `UnitExecutionScope`.

Reason: each has a concrete future re-evaluation trigger, so deleting it immediately would lose useful experimental seams. None currently has enough evidence to become the normal architecture.

## Cleanup decisions

Do **not** refactor `run.ts` merely because it is large.

Durable Execution should create the natural next boundary:

```text
Durable WorkflowState
→ explicit transitions / policy
→ bounded episode executors
→ persistence adapter
→ resume / reconciliation
```

Then `run.ts` can become a thinner coordinator.

Known cleanup debt entering Phase 4:

1. low-level `runV1Harness()` still defaults to historical `contextMode="baseline"`, while the normal CLI explicitly uses targeted context; switch the API default when the next tested workflow/config refactor touches this surface;
2. worktree isolation is used by benchmark/eval runners but is not mandatory at the raw `runV1Harness()` boundary; production/durable entrypoints should own workspace creation;
3. if Planner/Subagent/decomposition remain unjustified after larger Durable/GitHub workloads, move/remove experiment-only wiring from the core path;
4. benchmark breadth remains limited despite stronger holdout methodology;
5. current isolation/security is not hostile-code containment.

## Phase 4 entry question

Phase 3 optimized a working in-memory workflow.

Phase 4 now asks:

> What survives when the outer process dies, restarts, retries, loses ownership, or must resume work later?

That is the reason Durable Execution comes next.
