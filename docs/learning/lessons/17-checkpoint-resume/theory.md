# 17 — Checkpoint / Resume

## Mental model

A checkpoint is a **durable semantic recovery point**. Resume is a **fresh dispatch** from that committed state, not restoration of an old call stack.

```text
phase result produced
≠
phase durably committed
```

VERIFY PASS is an in-process fact. `review_ready` exists only after harness admission and successful persist.

```text
checkpoint = committed semantic recovery point
resume     = new executor chosen from persisted phase
```

## Mechanism

```text
spec_required
→ Spec
→ persist implementation_ready
→ capture/persist pre-Worker baseline A
→ Worker
→ VERIFY PASS
→ capture verified workspace B
→ persist review_ready
→ fresh process
→ validate B
→ load/validate A
→ reconstruct diff(A, B)
→ skip Worker
→ skip pre-review VERIFY
→ REVIEW
→ optional review repair + VERIFY
→ terminal
```

`WorkflowState` keeps a reference plus fingerprint for A. The snapshot itself is a separate artifact so review repair can later recompute `diff(A, repairedWorkspace)` against the original baseline.

## Boundaries

- Model cannot declare `review_ready`.
- `baseRevision` is not the review baseline: DEV fixtures may have legitimate pre-Worker working-tree changes.
- A persisted final diff is not the primary primitive.
- Crash after VERIFY PASS and before persist leaves authority at `implementation_ready`. No inference, silent promotion, or dirty Worker replay.

## Failures / trade-offs

Fail closed on missing/corrupt state, illegal transitions, workspace mismatch, or baseline integrity mismatch. No reconciliation.

Cost: extra persist/load around one safe semantic boundary. Benefit: a fresh process can enter independent REVIEW without rerunning completed mutating work.

## Observations

1. Resume is dispatcher-shaped: `nextDurableAction(review_ready) = continue_review`.
2. Workspace evidence on `review_ready` is artifact B, not the pre-Worker tree.
3. Review repair still verifies because it creates a new artifact.
4. `VERIFY PASS != review_ready` until rename/commit of WorkflowState.

## Takeaways

1. Persist semantic facts, not cognition or call stacks.
2. Commit is the authority boundary.
3. Keep large snapshots out of WorkflowState; store a referenced artifact.
4. Validate the bound workspace exactly; do not invent the next phase.
5. Independent REVIEW needs reconstructed inputs, not a replayed Worker/VERIFY.
6. Mid-crash reconciliation is a later module.
