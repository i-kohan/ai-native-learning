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

## Residual race

WorkflowState fencing does **not** fence GitHub. There remains a check→external-action race because GitHub does not enforce our fencing token.

Mitigation: ownership check immediately before privileged writes + deterministic identity + expected remote head + no force push + reconciliation.

This is not exactly-once delivery and not distributed consensus.

## Credentials

GitHub credentials belong only to the outer delivery layer. The model never receives them. Repository `npm test` uses the Module 09 allowlist, so `GITHUB_TOKEN` is dropped by omission.

CI logs are untrusted external data.

## Takeaways

1. Terminal implementation state and GitHub delivery state are different lifecycles.
2. Intended head ≠ observed GitHub head.
3. Exact-SHA CI admission is the only legal success path.
4. One CI repair is a new artifact and needs fresh VERIFY + REVIEW.
5. Fencing a local file is not fencing GitHub.
6. Ambiguous writes must be reconciled, not blindly retried.
