# 20 — GitHub / CI Integration

Практический журнал Module 20. Topic Chat closure: **PASS** on 2026-09-20; Master owns next-module selection.

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

Harness unit tests after CI01 evaluator strengthening: **254 passed**. Modules 16–19 durability/checkpoint/retry/ownership tests still pass.

## Live probes

GHI01 **PASS** (retained, not rerun):

- issue `#5`
- draft PR `#6`
- workflowId `GHI01-2026-09-19T18-12-22-355Z`
- baseSha `223d1111c8cca84ecc6e7d7cadcbf15ad13a7f82`
- H1 `11109909a22eaf7e87942ffc1f9e2515394f2c50`
- Actions run `35460488830` = PASS
- PR remains draft / unmerged

CI01 **PASS** (2026-09-20):

- issue `#7`
- draft PR `#9`
- workflowId `CI01-2026-09-20T13-09-15-630Z`
- baseSha `86e47b48a34976b75cdd0cb8d9840af330915940`
- H1 `cbb79d7aa4d20f903e76919b0258508e6f2c4df6`
- CI(H1) `35512678853` = FAIL (`Experiment CI01 fault`; local `npm test --prefix target-app` was green)
- repair from that H1 observation, `ciRepairAttempts` = 1
- fresh VERIFY(H2) PASS + independent REVIEW(H2) PASS
- H2 `fdc7b1ddd14ed8cc3af86eb6879fd890f7532c39`
- CI(H2) `35512702897` = PASS
- same PR `#9` advanced H1 → H2
- final phase `ready_for_human_review`
- PR remains draft / unmerged

Failed probe artifacts `#3` / `#4` were leftover GHI01 attempts and are closed. `#5` stays open while PR `#6` is the GHI01 artifact. PR `#8` is a failed CI01 attempt (host harness tests broke after extra DELETE tests were committed) and is closed as superseded; successful CI01 is draft PR `#9`.

Probe hygiene: `DELIVERY_PROBE_ISSUE` reuses an explicit issue; otherwise a failed/in-progress `traces/workflows/<probe>-latest-issue.json` is reused instead of creating another issue.

CI for delivery PRs now runs `npm test --prefix target-app`, matching local VERIFY. Full-repo `npm test` also runs harness tests that copy `target-app/tests` into calibration fixtures, so a green artifact can look red for the wrong reason.

## Topic Chat closure

**PASS — 2026-09-20.**

The frozen Module 20 success criteria are satisfied:

- real GitHub delivery path evidenced by GHI01;
- exact-current-head CI admission evidenced by GHI01/CI01;
- real controlled H1 red → one bounded repair → fresh VERIFY + independent REVIEW → H2 green evidenced by CI01;
- restart/PR reuse, stale-SHA rejection, unexpected remote movement, protected-branch rejection, no-force, and credential-isolation contracts covered deterministically;
- final authority remains human: both successful probe PRs are draft and unmerged.

This is **mechanism evidence**, not a claim of broad autonomous delivery reliability.

## Residual limits

- GitHub is observed by polling, not webhooks.
- Ownership check before push/PR is still check-then-act.
- One CI repair only.
- No merge, deploy, GitHub App, or secret manager.
