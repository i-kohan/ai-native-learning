# 13 — Subagents

Практический журнал Module 13. `theory.md` — короткий черновик; финальные выводы остаются для Topic Chat.

**Status:** mechanism + unit tests + P01 experiment + fixed regression done; module **not** complete until Topic Chat review.

## Что построили

```text
BASELINE: Spec → Worker → VERIFY / REVIEW
VARIANT:  Spec → Worker with optional delegate_research → at most one read-only child → Worker continues → same VERIFY / REVIEW
```

Это **agent-as-tool**, не новый outer phase как Planner.

- `harness/src/evidence.ts` — `EvidenceReport` schema, admission, `delegate_research` / `submit_evidence_report`
- `harness/src/research-subagent.ts` — отдельный read-only child episode в том же workspace
- `harness/src/loop.ts` — harness intercept `delegate_research`; бюджет 1 вызов
- `subagentsEnabled=false` по умолчанию; default tools не меняются
- `npm run benchmark:subagents` — P01, 3 valid trials × 2 arms

## Learning-critical files

1. `harness/src/loop.ts` — delegation boundary: Worker tool → harness intercept.
2. `harness/src/research-subagent.ts` — fresh child episode, physical tool restriction.
3. `harness/src/evidence.ts` — typed handoff + admission.
4. `harness/src/run.ts` — parent continues; VERIFY/REVIEW unchanged; child counted in e2e totals.
5. `harness/src/subagents-experiment.ts` — predefined decision rule.

## Mechanism tests

Harness unit suite: **135 passed**.

Covered without LLM:

- child cannot `write_file` / `run_command` / `delegate_research`
- invalid EvidenceReport rejected
- second delegation denied
- child uses parent workspace
- parent continues after a valid report
- default `subagentsEnabled=false` keeps existing Worker tools

Forced invocation lives only in these mocked tests, not in the P01 ROI prompt.

## Authority

```text
EvidenceReport = advice/evidence
≠ Spec
≠ permission
≠ verification
≠ workflow success
```

Child не получает Worker history. Outer harness по-прежнему владеет lifecycle.

## Controlled P01 experiment

Constants across arms: exact base SHA, same Spec, same model, `contextMode=variant`, `conversationStateMode=manual`, same VERIFY/REVIEW/repair budgets.

Contaminated: **0**. Natural `delegate_research`: **0/3** on Variant.

| Arm      | expected | first VERIFY | repairs | model/tools avg | tokens in/out avg | wall avg | child |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- | ----- |
| baseline | 3/3      | 3/3 PASS     | 0 / 0   | 9 / 21          | 38.6k / 4.0k      | ~47s     | 0 / 0 |
| variant  | 3/3      | 3/3 PASS     | 0 / 0   | 8 / 22          | 33.0k / 3.7k      | ~42s     | 0 / 0 |

Quality одинаковая. Child не вызывался. Directional cheaper Variant — обычный Worker noise, не выигрыш Subagents.

Predefined rule → **mechanism understood / ROI inconclusive**.

Default остаётся:

```text
Spec → Worker
subagentsEnabled = false
```

Evidence: `docs/learning/lessons/13-subagents/traces/subagents-m13-2026-08-28T12-27-46-204Z.txt`

## Fixed V3 regression

Evidence: `docs/learning/lessons/13-subagents/traces/2026-08-28T12-35-16-210Z.txt`

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

Subagents были выключены во fixed regression.

## Module decision

```text
research-child mechanism = implemented and understood
P01 adoption             = not justified / ROI inconclusive
normal default           = Spec → Worker, subagentsEnabled=false
```

Не считать модуль закрытым до Topic Chat.
