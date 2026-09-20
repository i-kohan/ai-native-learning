# 20 — GitHub / CI Integration

## Mental model

Module 20 is a **linked post-terminal lifecycle**. Modules 16–19 still own uncommitted durable work. Delivery begins only after `WorkflowState` is terminal success.

```text
WorkflowState terminal
→ DeliveryState (linked by workflowId)
→ commit H1
→ deterministic branch
→ draft PR
→ current-head CI
→ at most one semantic repair
→ H2
→ ready_for_human_review
```

`expectedHeadSha` is the locally accepted candidate the delivery workflow currently intends the remote PR head to represent. It is not a cached GitHub head.

## Authority

```text
WorkflowState          = durable implementation lifecycle
DeliveryState          = durable GitHub delivery lifecycle
lease / fencing token  = who may write authoritative local state
GitHub                 = observed external system, not a fenced resource
```

`runV1Harness()` still rejects terminal resume. Delivery does not reopen it.

## Intended vs observed

Persist enough identity to restart: repository, issue, branch, PR, `baseSha`, `expectedHeadSha`, phase, bounded CI observation, repair budget.

Do not persist full GitHub logs. Fetch again.

A network error after a write is **ambiguous**, not proof that the write did not happen. Reconcile before repeating create/push.

## Branch / PR reconciliation

Branch identity is `agent/<sanitized-workflowId>`. Never push to the default/protected branch. Never force-push. No merge authority. PR stays draft / ready for human review.

```text
remote absent or equals previous expected head
→ missing action may be performed

remote already equals intended new head
→ already happened; reconcile forward

remote is a third SHA
→ fail closed
```

PR: look up the deterministic branch/base pair, reuse if present, create only if absent.

## Current-head CI admission

A CI result may advance delivery only when `observation.headSha === expectedHeadSha`.

```text
expectedHeadSha = H2
CI(H1) = success
→ stale
→ must not produce ready_for_human_review
```

Classify before acting:

```text
semantic        → one bounded repair
infrastructure  → re-observe, do not edit code
policy          → stop
stale SHA       → ignore for admission
```

## CI scope is policy, not “more tests = better”

The delivery gate should verify the **candidate and contract being delivered**. A broader command is not automatically a stronger admission gate if it mixes unrelated meta-system checks into the candidate's delivery result.

For the Module 20 target-app delivery probes, local VERIFY and PR CI both use the target-app test contract. Full-repo harness tests remain valuable regression evidence for developing the harness itself, but they are a different check class and should not be silently conflated with target-app delivery admission.

In a mature system this usually becomes an explicit check policy:

```text
candidate-specific required checks
+ repository/platform health checks where policy requires them
+ optional/advisory checks
→ harness-owned admission decision
```

The key is not “run fewer checks”; it is **name which checks authorize which transition**.

## Residual race

WorkflowState fencing does **not** fence GitHub. There remains a check→external-action race because GitHub does not enforce our fencing token.

Mitigation: ownership check immediately before privileged writes + deterministic identity + expected remote head + no force push + reconciliation.

This is not exactly-once delivery and not distributed consensus.

## Credentials

GitHub credentials belong only to the outer delivery layer. The model never receives them. Repository `npm test` uses the Module 09 allowlist, so `GITHUB_TOKEN` is dropped by omission.

CI logs are untrusted external data.

## Validation boundary

Module 20 was validated with two mechanism probes:

- **GHI01:** real issue → locally accepted artifact → deterministic branch → real draft PR → CI PASS on the exact current head;
- **CI01:** real CI failure on H1 → failure evidence bound to H1 → one bounded repair → fresh VERIFY + independent REVIEW → H2 → the same PR → real CI PASS on H2.

These probes establish the delivery/control-flow mechanism and exact-head evidence discipline. They do **not** establish a statistical reliability claim for arbitrary repositories, CI failures, or autonomous repairs.

## Takeaways

1. Terminal implementation state and GitHub delivery state are different lifecycles.
2. Intended head ≠ observed GitHub head.
3. Exact-SHA CI admission is the only legal success path.
4. One CI repair is a new artifact and needs fresh VERIFY + REVIEW.
5. Fencing a local file is not fencing GitHub.
6. Ambiguous writes must be reconciled, not blindly retried.
7. CI scope is an explicit admission policy: evidence is useful only if the harness knows which transition that check is allowed to authorize.
