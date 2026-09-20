# Module 20 — GitHub / CI Integration — Master Closure

**Status:** ✅ MASTER CLOSED on 2026-09-20.

## Accepted result

Module 20 successfully moves the capstone from local workflow completion into a bounded real GitHub delivery lifecycle:

```text
successful terminal WorkflowState
→ linked DeliveryState
→ locally VERIFY + REVIEW accepted artifact
→ deterministic agent/<workflowId> branch
→ draft PR
→ exact-current-head GitHub Actions CI
→ optional one bounded semantic CI repair
→ fresh VERIFY + REVIEW
→ new head
→ current-head CI PASS
→ ready_for_human_review
```

The implementation correctly keeps `WorkflowState` terminal rather than appending GitHub phases to the implementation state machine.

## Live GHI01 evidence

Real GitHub objects were used:

- issue #5;
- draft PR #6;
- base SHA `223d1111c8cca84ecc6e7d7cadcbf15ad13a7f82`;
- candidate/head SHA `11109909a22eaf7e87942ffc1f9e2515394f2c50`;
- GitHub Actions run `35460488830` completed successfully;
- restart reused the same PR;
- PR remained draft and unmerged.

GHI01 therefore demonstrates real issue → accepted artifact → deterministic branch → draft PR → exact-head green CI.

## Live CI01 evidence

Real red → repair → green delivery was demonstrated:

- issue #7;
- draft PR #9;
- H1 `cbb79d7aa4d20f903e76919b0258508e6f2c4df6`;
- CI(H1) run `35512678853` = FAIL;
- failure evidence bound to H1;
- one bounded repair;
- fresh local VERIFY(H2) PASS;
- fresh independent REVIEW(H2) PASS;
- H2 `fdc7b1ddd14ed8cc3af86eb6879fd890f7532c39`;
- same PR advanced from H1 to H2;
- CI(H2) run `35512702897` = PASS;
- stale H1 evidence is classified stale / ignored for H2 admission;
- final phase = `ready_for_human_review`;
- PR remained draft and unmerged.

The strengthened CI01 evaluator requires the intermediate H1 failure and repair lifecycle; a final green H2 alone is insufficient.

## Accepted authority boundaries

- GitHub Issue remains raw input, not Spec or policy authority.
- GitHub credentials stay in the outer delivery layer.
- Repository/model execution uses the existing positive env allowlist and does not inherit GitHub tokens.
- No push to the default/protected branch.
- No force push.
- PR identity is reconciled/reused after restart or ambiguous create.
- Unexpected remote branch movement fails closed.
- CI success may authorize progress only when bound to `expectedHeadSha`.
- Semantic CI failure enters repair; infrastructure failure is re-observed; policy failure stops.
- CI repair produces a new artifact and therefore requires fresh VERIFY + REVIEW.
- Human retains merge authority.

## Scope boundaries

This remains mechanism evidence, not broad autonomous-delivery reliability evidence.

Explicitly not provided:

- auto merge or deployment;
- webhook/event-driven orchestration;
- GitHub App architecture;
- generic CI-provider abstraction;
- more than one CI semantic repair;
- exactly-once external delivery;
- GitHub-side enforcement of Module 19 fencing.

The residual ownership check → GitHub action race remains documented.

## Non-blocking metadata debt

The successful CI01 PR currently has actual head H2, while the PR description still contains the H1 `expectedHeadSha` captured when the PR was initially created.

This does **not** affect durable authority or CI admission: DeliveryState, actual PR head, and final CI evidence all identify H2 correctly. It is nevertheless stale human-facing metadata.

Future cleanup should either:

- update the PR body after a repaired head is admitted/published; or
- omit mutable `expectedHeadSha` from the PR body and keep only stable workflow/base identity.

This does not reopen Module 20.

## Final decision

```text
real GitHub issue/PR integration        = accepted
restart-safe branch/PR reconciliation  = accepted
exact-head CI admission                = accepted
live H1 red → repair → H2 green        = accepted
fresh VERIFY + REVIEW after repair     = accepted
credential / protected-branch boundary = accepted
human merge gate                       = preserved
remaining blockers                     = none
```

Next roadmap module remains **21 — Optional Browser QA**, subject to Master deciding whether the current capstone has enough meaningful UI surface to justify implementing it.
