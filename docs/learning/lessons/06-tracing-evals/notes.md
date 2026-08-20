# 06 — Tracing & Evals

Практический журнал. Measurement layer поверх V3; фиксированный suite прогнан. Модуль **не** закрыт: Topic Chat / Master смотрят evidence.

## Что это за урок одной фразой

Не строить новый tracing stack: нормализовать уже существующий `HarnessRunResult` в `RunMetrics`, агрегировать отдельно capability и mechanism probes.

## Как устроено

```text
npm run benchmark:eval
  T01–T04 (variant) + R01 + REV01
→ V3 HarnessRunResult (raw traces remain)
→ normalizeRun({ taskId, runId, result, expectedOutcomeMet })
→ aggregateRuns(RunMetrics[])
→ EvalResult + compact report + evals/*.json
```

Команды:

- `cd harness && npm test` — семантические тесты слоя без модели
- `cd harness && npm run benchmark:eval` — фиксированный suite + отчёт
- raw traces: `traces/*.jsonl` (gitignore)
- eval artifacts: `evals/*.json` / `evals/*.txt` (gitignore)
- lesson copies: `docs/learning/lessons/06-tracing-evals/traces/`

V3 control flow не менялся.

## Файлы, которые стоит лично просмотреть

1. `harness/src/eval/normalize.ts` — `normalizeRun`, T04 N/A, canonical verification sequence
2. `harness/src/eval/types.ts` — `RunMetrics` / `EvalResult`
3. `harness/src/eval/aggregate.ts` — знаменатели capability vs probes, hard vs diagnostic
4. `harness/src/run-benchmark.ts` — `runFixedSuite`, существующие graders
5. `harness/tests/eval.test.ts` — семантические инварианты

Поток: `runFixedSuite` → `scoreExpectedOutcome` (T01–T04 / R01 / REV01 graders) → `normalizeRun` → `aggregateRuns` → `formatEvalReport`.

## Семантика, которую нельзя смешивать

| Поле | Смысл |
| --- | --- |
| `expectedOutcomeMet` | выполнен benchmark contract этой задачи |
| `autonomousCompletion` | workflow success без escalation |
| `firstPassSuccess` | success без verification/review repair и без escalation |
| `escapedDefect` | workflow success, но независимый grader знает, что requirement нарушен |

T04 expected:

- `expectedOutcomeMet=true`
- `autonomousCompletion=false`
- `humanEscalation=true`
- `firstPassSuccess/eventualSuccess/recoveredSuccess=null`

R01/REV01 не входят в capability first-pass. Их recovered success — probe design.

Accepted blocker и rejected finding **не** становятся `falsePositive`. REV01 `intendedFindingDetected` / `unexpectedBlockingFindings` живут только в `probe`.

## Фактический suite (2026-08-20)

```text
Capability / Regression
Expected outcomes      4 / 4
Executable tasks        3
First-pass success     3 / 3
Eventual success       3 / 3
Recovered success      0 / 3
Correct escalations    1 / 1
Autonomous completion  3 / 4
Human escalation       1 / 4
Known escaped defects   n/a

Mechanism probes
R01 verification repair      PASS
REV01 independent review     PASS

All fixed benchmark contracts  6 / 6
Hard regressions: none
Diagnostics: none
```

| Task | Kind | expected | first-pass | verify | model/tools | tokens in/out | wall |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | capability | yes | yes | PASS | 7 / 11 | 15449 / 1759 | ~27s |
| T02 | capability | yes | yes | PASS | 7 / 15 | 19332 / 1686 | ~25s |
| T03 | capability | yes | yes | PASS | 7 / 15 | 19217 / 1634 | ~33s |
| T04 | capability | yes | n/a | n/a | 2 / 7 | 4445 / 847 | ~11s |
| R01 | probe / verification_repair | yes | no | FAIL→PASS | 10 / 19 | 28015 / 2271 | ~33s |
| REV01 | probe / independent_review_repair | yes | no | PASS→PASS | 11 / 21 | 27684 / 2633 | ~40s |

REV01: `firstVerificationPassed=true`, `verificationAttempts=2`, intended ARCH-01 detected, unexpected blocking=0, review repair=1. Это recovered success на probe, не capability first-pass miss.

## Ограничения / N/A

- `escapedDefect=null`: grader = harness `npm test`, независимого hidden-test GT нет.
- `failureLayer=null`: stop reason не классифицируется в MODEL/SPEC/...
- `turns` не входит в core eval metrics (reviewer turns считаются иначе, чем implementation).
- Dollar cost нет.
- Spec-phase `wallTimeMs=null`: отдельной spec duration в `HarnessRunResult` нет.
- `repoDiscoveryToolCalls` — только spec+impl `list_files`/`read_file`, не полный census.
- Efficiency regression без сохранённого baseline не считается hard и в этом прогоне не warning.
- Recurring findings с `observed=1` в JSON есть, в отчёт как recurring не печатаются.

## Evidence

- Report: `docs/learning/lessons/06-tracing-evals/traces/2026-08-20T11-39-01-776Z.txt`
- Normalized JSON: `docs/learning/lessons/06-tracing-evals/traces/2026-08-20T11-39-01-776Z.json`
- Raw traces рядом в той же папке (`T01`…`T04`, `R01`, `REV01`)
