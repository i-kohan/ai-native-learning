# 17 — Checkpoint / Resume

## Mental model

A checkpoint is a **durable semantic recovery point**. Resume is a **fresh dispatch from committed workflow state**, not restoration of an old call stack or model cognition.

```text
phase result produced
≠
phase durably committed
```

A successful phase result may still exist only inside one process. The next phase becomes authoritative only after the harness admits the transition and the checkpoint state is successfully persisted.

For this module:

```text
VERIFY PASS in process
≠
review_ready

VERIFY PASS
→ capture evidence for the verified artifact
→ harness admits transition
→ persist review_ready
=
committed recovery point
```

## Resume state machine

```text
spec_required
    → run Spec

implementation_ready
    → run Worker + pre-review VERIFY

review_ready
    → run independent REVIEW

terminal
    → reject further execution
```

The persisted phase selects the next executor. Resume does not try to infer where an interrupted function or model call stopped.

## `review_ready` contract

`review_ready` means more than “VERIFY passed sometime before”. It binds three semantic facts:

1. **Baseline A** — the pre-Worker source snapshot used as the review baseline.
2. **Verified artifact B** — the exact workspace state that passed pre-review VERIFY.
3. **Verification evidence** — the admitted PASS that allowed B to cross the boundary into REVIEW.

The baseline snapshot is stored as a separate durable artifact. `WorkflowState` stores its reference and fingerprint rather than embedding the full snapshot.

The checkpoint workspace evidence is captured **after successful VERIFY**, so it describes B, not A.

## Mechanism

```text
spec_required
→ Spec
→ persist implementation_ready
→ capture/persist pre-Worker baseline A
→ Worker
→ VERIFY PASS
→ capture verified workspace B
→ admit + persist review_ready(A-ref, B, VERIFY evidence)
→ process dies

fresh process
→ load review_ready
→ validate current workspace == B
→ load baseline A and validate its fingerprint
→ reconstruct diff(A, B)
→ skip Worker
→ skip already-committed pre-review VERIFY
→ independent REVIEW
→ optional review repair
→ VERIFY repaired artifact
→ REVIEW again if required
→ terminal
```

A persisted final diff is not the primary primitive. If REVIEW repairs B into C, the next review round must be able to recompute `diff(A, C)` against the original baseline.

`baseRevision` alone is also insufficient as the review baseline because the legitimate pre-Worker working tree may already differ from the Git commit, for example because of DEV fixture setup.

## Crash boundary

The important distinction is whether `review_ready` was durably committed.

```text
implementation_ready persisted
→ Worker mutates A → B
→ VERIFY PASS
→ crash before review_ready persist
```

Authority is still `implementation_ready`. If the workspace now differs from the persisted checkpoint, resume fails closed. This module does not infer that Worker or VERIFY “probably finished”, does not silently promote the phase, and does not replay Worker on dirty state.

By contrast:

```text
VERIFY PASS
→ review_ready persisted for B
→ crash
→ fresh process validates B
→ REVIEW
```

Here Worker and the pre-review VERIFY are already committed work and should not be rerun merely to reconstruct execution state.

## Integrity rules

Fail closed when any required authority or evidence is inconsistent:

- missing/corrupt `WorkflowState`;
- illegal phase transition;
- current workspace does not match the workspace evidence bound to `review_ready`;
- review baseline artifact is missing or its fingerprint does not match;
- terminal workflow is resumed.

The model cannot declare `review_ready`; transition admission is harness-owned.

## What must and need not be durable

Durable because the next executor needs it for correctness:

- Spec and existing workflow identity;
- `review_ready` phase;
- verified workspace evidence;
- reconstructable pre-Worker review baseline reference + integrity evidence;
- compact verification evidence needed by REVIEW.

Recomputable or unnecessary for resume correctness:

- repository map / targeted context;
- current source snapshot;
- Worker conversation history;
- model reasoning;
- full traces;
- full `AgentRunResult`.

The principle is:

> Persist semantic authority and enough evidence to reconstruct the next executor's required inputs, not the previous executor's cognition.

## Bounded scope

Module 17 proves checkpoint/resume for the current bounded durable workflow. It does **not** yet pin every external policy/config input across processes. In CHK01, review policy such as architecture constraints is held fixed by the workload/config rather than becoming new durable workflow authority.

That is an explicit scope boundary, not a claim that arbitrary configuration changes across resume are safe.

Also out of scope:

- retry/idempotency semantics;
- arbitrary side-effect reconciliation;
- mid-Worker or mid-VERIFY recovery;
- exactly-once execution;
- event sourcing / Temporal-style orchestration;
- leases or concurrent resume.

## Takeaways

1. A checkpoint is a **semantic commit boundary**, not a memory dump.
2. Resume is **state-machine dispatch**, not call-stack restoration.
3. `VERIFY PASS` becomes reusable authority only when the harness successfully commits `review_ready`.
4. A phase must be bound to the concrete external artifact it claims is complete.
5. REVIEW needs the original baseline A plus the verified current artifact B; a phase label alone is insufficient.
6. Already committed work is skipped; new mutations such as review repair must be verified again.
7. Ambiguous pre-commit side effects fail closed here; reconciliation belongs to later retry/idempotency work.
