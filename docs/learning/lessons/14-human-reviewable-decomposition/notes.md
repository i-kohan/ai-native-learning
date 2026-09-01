# 14 — Human-Reviewable Decomposition

Практический журнал Module 14. Conceptual material: [`theory.md`](./theory.md). Принятие — Topic Chat / Master.

**Status:** ✅ COMPLETED — mechanism + correction + two P02 experiments + ownership cleanup + human review + understanding check done. Closed by Topic Chat on 2026-09-01; return to Master/Roadmap for the next module.

## Что построили

```text
BASELINE: Spec → one Worker → VERIFY / REVIEW → final diff
VARIANT:  Spec → manual advisory ReviewPlan → UnitExecutionScope per episode
          → sequential units A→B→C (snapshot + scoped verify gate)
          → final VERIFY / REVIEW → final diff + per-unit diffs
```

- `benchmarks/P02/` — due dates
- `harness/src/review-plan.ts` — schema, admission, `UnitExecutionScope`, handoff
- `harness/src/run.ts` — sequential unit Workers; failed scoped verify stops later units
- `harness/src/decomposition-experiment.ts` — P02 semantic ownership bind + decision rule
- `npm run benchmark:decomposition`
- Default unchanged: Spec → one Worker. No LLM Review Planner.

## Learning-critical files

1. `harness/src/review-plan.ts` — Spec / ReviewPlan / UnitExecutionScope; coverage; shared ownership.
2. `harness/src/run.ts` — real unit diffs; intermediate VERIFY is a hard gate.
3. `harness/src/decomposition-experiment.ts` — P02 ownership mapping; cost does not auto-reject.
4. `benchmarks/P02/` — task + three unit test files.
5. First experiment: `traces/decomposition-m14-2026-08-29T11-20-11-746Z.txt`
6. Corrected experiment: `traces/decomposition-m14-corrected-2026-08-31T12-13-58-044Z.txt`

## ReviewPlan schema

```text
ReviewPlan { decision: single_change | decompose, rationale, units[] }
ChangeUnit { id, intent, acceptanceRefs, dependsOn[], verificationIntent[] }
UnitExecutionScope { currentUnitId, currentIntent, acceptanceRefs, deferredUnits[] }
```

Admission: unique ids; dependsOn exist and are acyclic; refs ∈ Spec.acceptance; decompose covers every acceptance item; duplicate ownership is valid; plan does not mutate Spec.

No `likelyFiles`.

## P02 mapping

- A: create/default/invalid `dueAt`, complete/reopen preserve `dueAt`
- B: PATCH set/clear / 400 / 404
- C: `due=overdue` + completed exclusion + status composition
- Shared A+C: lifecycle preservation criterion that also states reopened overdue behavior
- Existing-regression criteria may attach to all units because every intermediate state must preserve them

Ownership is semantic, not substring-by-file or winner-takes-all. In particular, the word `completed` inside an overdue-only criterion must **not** make that criterion belong to A.

## First P02 experiment (keep)

Constants: `contextMode=variant`, `conversationStateMode=manual`. Harness suite then: **152 passed**. Contaminated: **0**.

| Arm      | expected | first VERIFY | repairs | model/tools avg | tokens in/out avg | wall avg |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- |
| baseline | 3/3      | 3/3 PASS     | 0 / 0   | 10 / 26         | 63.9k / 6.2k      | ~89s     |
| variant  | 3/3      | 3/3 PASS     | 0 / 0   | 20 / 48         | 125.0k / 9.1k     | ~101s    |

| Trial | A | B | C |
| ----- | - | - | - |
| 1 | 3 files, 311 lines | empty | empty |
| 2 | 3 files, 305 lines | empty | `task-service.ts`, 133 lines |
| 3 | 3 files, 307 lines | empty | empty |

Advisory ReviewPlan alone failed to materialize review boundaries: Worker still had the full Spec and no harness-owned execution-scope boundary. Old cost-based reject was the wrong auto-rule for this module.

Evidence: `traces/decomposition-m14-2026-08-29T11-20-11-746Z.txt`

## Correction

1. Split ReviewPlan (advisory) from `UnitExecutionScope` (harness-owned episode control).
2. Failed intermediate scoped VERIFY stops later units (`unit_verification_failed`); final full VERIFY still runs.
3. Shared AC ownership is valid; unmapped coverage fails bind.
4. Decision: worse quality / invalid intermediate → reject; empty later diffs → `mechanism_failed`; equal quality + real A/B/C diffs → `candidate_pending_human_review` even if more expensive. No auto-adopt.

## Corrected P02 experiment

Same 3×3, model, `contextMode=variant`, `conversationStateMode=manual`. Harness suite at that run: **159 passed**. Contaminated: **0**.

| Arm      | expected | first VERIFY | repairs | model/tools avg | tokens in/out avg | wall avg |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- |
| baseline | 3/3      | 3/3 PASS     | 0 / 0   | 11 / 25         | 56.9k / 5.5k      | ~74s     |
| variant  | 3/3      | 3/3 PASS     | 0 / 0   | 22 / 46         | 130.4k / 10.1k    | ~128s    |

Blocking review findings: 0. Intermediate unit VERIFY: 3/3 PASS. Empty unit diffs: **0**.

| Trial | A | B | C |
| ----- | - | - | - |
| 1 | types+service+routes, 224 | routes+service, 265 | routes+service, 312 |
| 2 | types+service+routes, 220 | routes+service, 270 | routes, 211 |
| 3 | types+service+routes, 221 | routes+service, 266 | routes+service, 294 |

Scope was respected in source: A added `dueAt` create/types only (no PATCH route, no overdue filter). B added PATCH. C added `due=overdue`.

Decision before human review: **`candidate_pending_human_review`**. Default stayed Spec → one Worker.

Human review reports:

- `traces/P02-decomp-v2-variant-1-2026-08-31T12-17-43-955Z.review-units.md`
- `traces/P02-decomp-v2-variant-2-2026-08-31T12-20-05-589Z.review-units.md`
- `traces/P02-decomp-v2-variant-3-2026-08-31T12-22-03-621Z.review-units.md`

Evidence: `traces/decomposition-m14-corrected-2026-08-31T12-13-58-044Z.txt`

## Post-review ownership cleanup

Topic Chat found one metadata bug after the corrected run: A's historical `acceptanceRefs` over-attached some overdue-only criteria because the matcher treated `complete` inside `completed` as lifecycle-preservation evidence.

Current binding now requires all three signals before A owns lifecycle preservation:

```text
complete/completion + reopen
+ dueAt/due-date reference
+ preservation meaning (preserve / retain / unchanged / survive)
```

Therefore:

- `completed tasks are excluded from overdue results` → C only;
- `complete and reopen retain dueAt, and reopening overdue appears in results` → A + C;
- PATCH remains B;
- create/default/validation remains A.

Focused regression tests cover the real resolved-P02 wording and the `completed` false-positive case.

This cleanup changes ReviewPlan bookkeeping only. It does **not** change the already-recorded Worker source diffs, verification results, costs, or experiment decision. Historical trace/review-report artifacts are intentionally preserved unchanged, so their old `acceptanceRefs` remain evidence of what the run actually emitted.

No new P02 benchmark or fixed-suite rerun is claimed for this post-review bookkeeping cleanup.

## Human review signal

Topic Chat compared the same P02 result in two review surfaces:

```text
one final unified change
vs
A → B → C semantic units
```

Observed human signal:

- the full P02 change was still small/cohesive enough to fit in one mental model;
- reviewing A, then B, then C was nevertheless clearly easier and more understandable;
- each unit felt locally complete and reviewable;
- no unit required the reviewer to reconstruct the whole future feature to understand its purpose;
- the benefit was real but not dramatic because P02 itself is near the lower size/complexity boundary where decomposition may pay off.

Therefore P02 supports **human-reviewability benefit**, but does **not** justify making decomposition the default. The variant cost roughly ~2× model calls/tokens and materially more wall time.

## Final policy

```text
single_change = default

decompose when:
- the change contains multiple genuine semantic concerns;
- each unit has one understandable goal;
- each unit is locally reviewable and verifiable;
- intermediate states remain valid;
- dependencies are explicit;
- the reduction in human cognitive load is worth the extra orchestration / verification cost.
```

Do **not** decompose merely because a change can technically be split or because smaller diffs look nicer. Small/file-based/micro-change slicing can make review worse by increasing context switching and dependency overhead.

P02 conclusion:

> Human reviewability improved, but P02 is near the lower boundary where the additional orchestration cost becomes questionable.

## Fixed V3 regression

First run after the initial probe: `traces/2026-08-29T11-33-40-045Z.txt` — 6/6 contracts, ISO01 PASS, SEC01 PASS, decomposition off.

Corrected-run regression: `traces/2026-08-31T12-27-55-652Z.txt`

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed V3 contracts      6 / 6
ISO01                       PASS
SEC01                       PASS
Hard regressions            none
```

Decomposition stayed off on the fixed suite (`bindReviewPlan` not supplied).

## Understanding check

Final Topic Chat check passed after one correction.

Correctly understood:

- ReviewPlan is advisory and cannot redefine product truth;
- UnitExecutionScope is harness process authority for the current episode, subordinate to the final Spec;
- a smaller diff is not automatically a better review unit;
- `single_change` is preferable when the whole change is already easy to understand and the split would not repay its cost.

Correction made during the check: the reason “smaller diffs are not automatically better” is not only cost; semantic cohesion and context-switch/dependency overhead matter too.

## Module decision

```text
review-decomposition mechanism = implemented + corrected + understood
P02 first experiment           = mechanism_failed / no genuine surfaces
P02 corrected experiment       = quality preserved + genuine A/B/C surfaces
human review signal            = positive, but modest on this P02-sized feature
adoption                       = conditional, not default
normal default                 = Spec → one Worker, single_change first-class
```

✅ Module 14 closed by Topic Chat on 2026-09-01. Return to Master/Roadmap; do not auto-open the next module here.
