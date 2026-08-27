# 12 — Planner / Worker / Reviewer

Практический журнал. Controlled P01 probe: явный read-only Planner vs текущий implicit planning у Worker.

**Status:** in progress — механизм и эксперимент записаны; модуль не закрыт.

Theory: `theory.md`

## Что это за урок одной фразой

Planner — отдельный read-only episode с advisory Plan. Spec остаётся authority. Reviewer Plan не видит. Default не меняется без evidence.

## Что построили

```text
BASELINE: Spec → Worker (implicit planning) → VERIFY / REVIEW
VARIANT:  Spec → read-only Planner → advisory Plan → Worker → same VERIFY / REVIEW
```

- `harness/src/plan.ts` — schema, admission, Worker handoff, likelyFiles ≠ edit scope
- `harness/src/planner-phase.ts` — read-only tools + `submit_plan`
- `run.ts` — `planningEnabled` default `false`
- `benchmarks/P01/` — task + failing priority tests
- `npm run benchmark:planning` — 3 valid trials × 2 arms

## Команды

```bash
cd harness && npm test
cd harness && npm run benchmark:planning
```

## Файлы, которые стоит лично посмотреть

1. `harness/src/plan.ts` — Plan contract, admission, authority rule, handoff
2. `harness/src/planner-phase.ts` — read-only Planner loop
3. `harness/src/run.ts` — Spec → optional Planner → Worker; Reviewer без Plan
4. `harness/src/planning-experiment.ts` — predefined decision rule + report
5. traces: `docs/learning/lessons/12-planner-worker-reviewer/traces/planning-m12-2026-08-27T12-46-15-463Z.txt`

## Experiment (2026-08-27)

Оба arm 3/3 expected, first VERIFY PASS, 0 verification-repair, 0 review-repair. Contaminated: 0.

| Arm | calls/tools | tokens in/out | wall | planner | worker |
| --- | ----------- | ------------- | ---- | ------- | ------ |
| baseline | 8 / 23 | 36.6k / 3.7k | ~51s | 0 / 0 | 5 / 12 |
| variant | 12 / 31 | 56.6k / 5.3k | ~64s | 2 / 8 | 7 / 12 |

Quality equal. Variant дороже e2e по calls, tokens и wall. Worker-only не улучшился.

Predefined rule п.4 → **reject Planner**. Default остаётся Spec → Worker.

Нюанс: в variant #2/#3 `likelyFiles` включали tests/package.json; Worker их не менял.

Harness unit tests at experiment time: 121 passed.

## Review gap fixes (2026-08-27)

1. **Cycle admission.** `parseSteps` rejects general `dependsOn` cycles (two-step and longer), not only self-deps / invalid indexes. Still no DAG executor.
2. **Equal-quality decision.** No numeric meaningful e2e threshold was predefined, so directional improvement is `inconclusive`, not `candidate`. Compared signals: model calls, tool calls, input tokens, output tokens, wall time. Clear regression still `reject`. Historical P01 artifact unchanged; reject still holds.

P01 not rerun.

Harness unit tests after the fixes: **125 passed**.

## Fixed V3 regression after gap fixes

`npm run benchmark:eval` — Planner off. 6/6, ISO01 PASS, SEC01 PASS, no hard regressions.

Report: `traces/2026-08-27T13-21-46-170Z.txt`

| Task  | expected | first-pass | verify    | model/tools | tokens in/out | wall |
| ----- | -------- | ---------- | --------- | ----------- | ------------- | ---- |
| T01   | yes      | yes        | PASS      | 7 / 13      | 17288 / 1831  | ~28s |
| T02   | yes      | yes        | PASS      | 8 / 14      | 17264 / 1644  | ~21s |
| T03   | yes      | yes        | PASS      | 7 / 16      | 19304 / 1507  | ~21s |
| T04   | yes      | n/a        | n/a       | 2 / 7       | 4445 / 952    | ~9s  |
| R01   | yes      | no         | FAIL→PASS | 10 / 21     | 27527 / 2086  | ~27s |
| REV01 | yes      | no         | PASS→PASS | 11 / 21     | 30156 / 2522  | ~34s |

Модуль **не** закрыт.
