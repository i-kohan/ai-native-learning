# 10 — Model Routing

Практический журнал. Минимальный phase→model resolver + controlled R01 Luna vs Terra-repair comparison.

**Status:** ✅ COMPLETED — formally closed by Topic Chat on 2026-08-25 after code/evidence review.

Theory: `docs/learning/lessons/10-model-routing/theory.md`

## Что это за урок одной фразой

Routing выбирает только модель для semantic episode. Он не даёт более сильной модели больше authority.

## Как устроено

```text
resolveModel(episode, config)
  episode === "repair" && OPENAI_REPAIR_MODEL
    → model = override, reason = repair_override
  иначе
    → model = OPENAI_MODEL, reason = default
```

Эпизоды: `spec | implementation | repair | review | review_repair`.

`review_repair` не наследует verification-repair override.

Resolver не выбирает: tools, permissions, VERIFY, review acceptance, SpecDecision, limits, Skills, workspace, security.

Команды:

- `cd harness && npm test`
- `cd harness && npm run benchmark:routing`
- `cd harness && npm run benchmark:eval`

## Файлы, которые стоит лично посмотреть

1. `harness/src/model-routing.ts` — `resolveModel`, только выбор модели
2. `harness/src/config.ts` — optional `repairModel` / `OPENAI_REPAIR_MODEL`
3. `harness/src/loop.ts` / `spec-phase.ts` / `review-phase.ts` — call sites через resolver
4. `harness/src/routing-experiment.ts` — trial validity, SLO, report; не выбирает политику
5. `docs/learning/lessons/10-model-routing/traces/routing-m10-2026-08-25T10-54-03-280Z.txt`

Поток варианта: spec/impl Luna → R01 404→500 → VERIFY FAIL → repair Terra → VERIFY PASS → review Luna.

## Routing experiment (2026-08-25)

SLO задан заранее: 3/3 valid R01 contract per model.

| Arm | model | valid/attempted | contaminated | SLO |
| --- | ----- | --------------- | ------------ | --- |
| BASELINE | Luna repair | 3/3 | 0 | MET |
| VARIANT | Terra repair | 3/3 | 0 | MET |

Repair averages: Luna 4/6 calls/tools, 17130/1031 tokens, ~12.2s. Terra 4/7, 17254/1009 tokens, ~10.5s.

Whole-workflow wall average: Luna ~31.2s, Terra ~30.5s.

Trace provenance example (variant trial 1): spec/impl/review = Luna/`default`; repair = Terra/`repair_override`.

## Topic Chat engineering decision

Both models met the predefined quality SLO 3/3. Quality therefore did not justify the stronger model.

Terra was somewhat faster inside the repair episode, but the end-to-end latency improvement was small while current text-token rates are roughly an order of magnitude higher than Luna for the compared family.

Therefore the current permanent policy is:

```text
spec            → Luna
implementation  → Luna
repair          → Luna
review          → Luna
review_repair   → Luna
```

`OPENAI_REPAIR_MODEL` remains an optional experimental/operational override, but normal policy does not enable `repair → Terra`.

This is intentionally a scoped conclusion: the experiment shows that Luna is sufficient for the current controlled R01 workload. It does not prove Luna is always preferable for naturally occurring or more complex repairs.

## V3 regression (fixed-v3-m09, unchanged denominators)

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01                         PASS
REV01                       PASS
All fixed V3 contracts      6 / 6
ISO01                       PASS
SEC01                       PASS
Hard regressions            none
```

Harness tests: 94 passed (было 86; +8 routing/validity).

## Нюансы

- Backward compatible: без `OPENAI_REPAIR_MODEL` поведение как раньше.
- Routing experiment отдельно от `benchmark:eval`; 6/6 не раздувается повторными R01.
- Contaminated trial ≠ model failure. На этом прогоне contamination не было.
- Variant trial 1: 11 workflow model calls вместо 10 — лишний non-repair turn, не смена repair-call count.
- `No heterogeneous routing justified` — корректный результат, а не провал урока.
- Role-specific / specialized models могут быть полезны, но это hypothesis, которую надо подтверждать eval evidence.

## Personal takeaways

Routing как явный boundary полезнее, чем «просто сменить модель везде». Мы можем независимо проверять model allocation по semantic episodes, не смешивая выбор модели с authority.

На текущем R01 Luna уже проходит SLO; более дорогая Terra не дала достаточного incremental benefit, поэтому permanent override не нужен.
