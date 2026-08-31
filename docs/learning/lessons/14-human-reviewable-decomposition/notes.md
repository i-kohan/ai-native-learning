# 14 — Human-Reviewable Decomposition

Практический журнал Module 14. Conceptual material: [`theory.md`](./theory.md). Принятие — Topic Chat / Master.

**Status:** mechanism + unit tests + P02 experiment + fixed regression done; **not** accepted by Master.

## Что построили

```text
BASELINE: Spec → one Worker → VERIFY / REVIEW → final diff
VARIANT:  Spec → manual advisory ReviewPlan → sequential units A→B→C
          (source snapshot + scoped verify after each)
          → final VERIFY / REVIEW → final diff + per-unit diffs
```

- `benchmarks/P02/` — due dates
- `harness/src/review-plan.ts` — schema, admission, coverage, handoff
- `harness/src/run.ts` — sequential unit Workers when `bindReviewPlan` is supplied
- `harness/src/decomposition-experiment.ts` — P02 templates + decision rule
- `npm run benchmark:decomposition`
- Default unchanged: Spec → one Worker. No LLM Review Planner.

## Learning-critical files

1. `harness/src/review-plan.ts` — ReviewPlan ≠ Spec; coverage/cycles.
2. `harness/src/run.ts` — real unit diffs, not labels on one final diff.
3. `harness/src/decomposition-experiment.ts` — P02 bind + reject-on-overhead rule.
4. `benchmarks/P02/` — task + three unit test files.
5. `docs/learning/lessons/14-human-reviewable-decomposition/traces/decomposition-m14-2026-08-29T11-20-11-746Z.txt`

## ReviewPlan schema

```text
ReviewPlan { decision: single_change | decompose, rationale, units[] }
ChangeUnit { id, intent, acceptanceRefs, dependsOn[], verificationIntent[] }
```

Admission: unique ids; dependsOn exist and are acyclic; refs ∈ Spec.acceptance; decompose covers every acceptance item; plan does not mutate Spec.

No `likelyFiles`.

## P02 acceptance (task)

- optional `dueAt: string | null`
- POST default / explicit null / `Date.parse` validity / 400
- PATCH set/clear; omitted/`dueAt` missing/non-object → 400; unknown → 404
- GET `due=overdue`: pending and `Date.parse(dueAt) < now`; composes with status; other `due` → 400
- complete/reopen preserve `dueAt`

Proposed units: A capability (no deps) → B mutation (depends A) → C overdue (depends A).

## Controlled P02 experiment

Constants: exact SHA, `contextMode=variant`, `conversationStateMode=manual`, same VERIFY/REVIEW. Variant has **no** extra Planner model.

Harness unit suite at implementation: **152 passed**.

Contaminated: **0**.

| Arm      | expected | first VERIFY | repairs | model/tools avg | tokens in/out avg | wall avg |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- |
| baseline | 3/3      | 3/3 PASS     | 0 / 0   | 10 / 26         | 63.9k / 6.2k      | ~89s     |
| variant  | 3/3      | 3/3 PASS     | 0 / 0   | 20 / 48         | 125.0k / 9.1k     | ~101s    |

Review findings: 0 blocking on both arms. Intermediate unit VERIFY: 3/3 PASS.

### Actual unit diffs

| Trial | A | B | C |
| ----- | - | - | - |
| 1 | 3 files, 311 lines | empty | empty |
| 2 | 3 files, 305 lines | empty | `task-service.ts`, 133 lines |
| 3 | 3 files, 307 lines | empty | empty |

A always implemented the whole feature (types + service + routes). B never had a source delta. Scoped A tests do not prohibit PATCH/overdue, so later units were already satisfied.

Predefined rule → **reject**. Overhead without extra reviewable surfaces.

Default:

```text
Spec → one Worker
single_change is first-class
```

Evidence: `traces/decomposition-m14-2026-08-29T11-20-11-746Z.txt`

## Fixed V3 regression

Evidence: `traces/2026-08-29T11-33-40-045Z.txt`

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

## Observation

Giving the Worker the full Spec plus “implement only this unit” did not enforce the review boundary. The harness recorded empty later diffs instead of violating the Spec. That is the correct failure mode for this probe.

P01 remains the smaller negative example. P02 shows the same cohesion at a slightly larger size: a semantic split can be written down, but one Worker still delivers one change.

Не считать модуль принятым до Topic Chat.
