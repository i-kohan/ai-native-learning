# 20 — GitHub / CI Integration

Практический журнал Module 20. Formal closure remains with Topic Chat / Master.

## What we built

Separate durable `DeliveryState` linked by `workflowId`. Modules 16–19 semantics are unchanged: `WorkflowState` terminal stays terminal, and durable workspace resume still assumes `HEAD === persisted headRevision === baseRevision` on an uncommitted tree.

Delivery is post-terminal:

```text
validate terminal success + uncommitted accepted workspace
→ local VERIFY (+ delivery REVIEW before first commit)
→ commit H1
→ persist expectedHeadSha = H1
→ push agent/<workflowId> without force
→ reuse or create draft PR
→ poll GitHub Actions
→ admit only current-head CI
→ at most one semantic repair
→ fresh VERIFY + REVIEW
→ commit H2
→ expectedHeadSha = H2
→ same PR
→ current-head CI PASS
→ ready_for_human_review
```

## Learning-critical files

1. `harness/src/delivery-state.ts` — phases, `expectedHeadSha`, admission.
2. `harness/src/delivery-store.ts` — fenced DeliveryState persistence under the Module 19 lease.
3. `harness/src/github-client.ts` + `github-delivery.ts` — intended vs observed GitHub, no force push.
4. `harness/src/ci-admission.ts` — exact-head admission and failure classes.
5. `harness/src/delivery-run.ts` — post-terminal runner; does not reopen `runV1Harness()`.
6. `harness/src/delivery-accept.ts` — fresh VERIFY/REVIEW and one CI repair adapter.
7. `.github/workflows/ci.yml` — smallest `pull_request` workflow. No `pull_request_target`.

## Phases

```text
local_accepted
head_committed
branch_reconciled
pr_reconciled
ci_waiting
ready_for_human_review
delivery_failed
```

`expectedHeadSha` changes only after local acceptance. Old H1 VERIFY/REVIEW/CI cannot authorize H2.

## Ownership vs GitHub

The delivery runner acquires the same workflow lease. Privileged git/GitHub writes assert current ownership immediately before the action.

Explicit residual race:

```text
WorkflowState fencing does NOT fence GitHub.
check → external action remains racy because GitHub does not enforce our fencing token.
```

No exactly-once claim.

## CI01 fault

Smallest experiment-only mechanism: `harness/fixtures/ci01.red`.

- Local `npm test` ignores it.
- GitHub Actions has an extra step that fails when the file is present.
- Worker reliability is not sabotaged.
- Normalized evidence containing `CI01_CONTROLLED_RED` drives harness-owned removal of that file, then fresh VERIFY + REVIEW.

Why this instead of a generic fault-injection platform: it is one file and one workflow step, enough to guarantee `CI(H1) FAIL` after local green.

## Commands

```bash
npm test
npm run benchmark:ghi01
npm run benchmark:ci01
```

Live probes require `GITHUB_TOKEN` or `GH_TOKEN` in the delivery-layer environment only.

## Deterministic tests

`harness/tests/delivery.test.ts` covers PR reuse, `ci_waiting` restart, stale SHA rejection, unexpected remote movement, protected branch, no force-push, ambiguous create-PR reconcile, semantic vs infrastructure CI, repair SHA change + fresh REVIEW, and credential isolation.

Harness unit tests after implementation: **252 passed** (was 239). Modules 16–19 durability/checkpoint/retry/ownership tests still pass.

## Live probes

GHI01 and CI01 were implemented and wired, but this session had no GitHub token in the environment (`gh` absent, `GITHUB_TOKEN`/`GH_TOKEN` unset). Live issue/PR/Actions evidence is therefore **not recorded**. Do not treat the mechanism as GHI01/CI01 PASS.

## Residual limits

- GitHub is observed by polling, not webhooks.
- Ownership check before push/PR is still check-then-act.
- One CI repair only.
- No merge, deploy, GitHub App, or secret manager.
