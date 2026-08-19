# 04 — Verification + bounded Repair

Практический журнал. V2 loop + R01 controlled probe прогнаны; Topic Chat review ещё не закрывал модуль. `theory.md` пишет Topic Chat после review.

## Что это за урок одной фразой

Терминальный ответ модели заканчивает **эпизод**, а не workflow. Внешний `npm test` остаётся истиной; при FAIL harness нормализует факт и даёт bounded repair.

## Как устроено

```text
SPEC / GATE
→ IMPLEMENT (agent episode; terminal ≠ verified)
→ [R01 only] inject missing-task 404→500 once
→ VERIFY (harness-owned npm test)
   ├─ PASS → verified success
   └─ FAIL
       → normalizeFailure (what failed, not why/how to fix)
       → nextRepairDecision (maxRepairAttempts=2; optional repeated-failure stop)
       → REPAIR episode (resolved spec + failure evidence + same src-only tools)
       → VERIFY again
```

Команды:

- `cd harness && npm test` — механические тесты без модели
- `cd harness && npm run benchmark:r01` — контролируемый repair probe
- T01–T04 / `benchmark:experiment` в этом модуле **не** гонялись

Локальный прогон: `traces/R01-repair-*.jsonl` (gitignore).  
Evidence: `docs/learning/lessons/04-verification-repair/traces/`.

## Границы, которые нельзя смешивать

1. **Agent-controlled `npm test`** (`run_command`) — наблюдение для модели.
2. **Harness-controlled final verification** — authority completion.
3. **Normalization** — компактный факт (`failedTests`, `500 !== 404`), не диагноз и не предписание фикса.
4. **Retry policy** — у harness, не у verifier и не у модели.

Fault injection живёт только в R01 (`r01-fault.ts` + `afterImplementationEpisode`). Это не production behavior.

## R01 — что доказали / что нет

Доказали на одном контролируемом дефекте:

```text
external FAIL → normalized evidence → repairAttempts=1 → PASS → verified success
```

Repair получил resolved spec + failure evidence; записал только `tasks/task-routes.ts`.

Не доказали: spontaneous error rate модели, регресс T01–T04, сравнение с V1, качество repair на «настоящих» ошибках агента.

## Файлы, которые стоит лично просмотреть

1. `harness/src/run.ts` — `runVerifyRepairLoop`: VERIFY → REPAIR → VERIFY и `workflow_status`
2. `harness/src/failure.ts` — `normalizeFailure`
3. `harness/src/repair.ts` — `nextRepairDecision` / `formatRepairContract`
4. `harness/src/loop.ts` — `runAgentLoop`: episode stop ≠ verified completion
5. `harness/src/tools.ts` — write только `target-app/src/`; `npm test` у агента vs verifier
6. `harness/src/r01-fault.ts` + `run-benchmark.ts` `runRepairProbe` — одноразовый controlled defect

## Наблюдения с R01 (2026-08-18)

- Implementation на зелёном fixture ничего не менял (`changedFiles: []`), затем injection, затем repair вернул 404. Финальный workflow diff пустой — ожидаемо.
- Repair episode: 4 model / 6 tools; `write_file` только `tasks/task-routes.ts`; потом agent `npm test`; harness verifier #2 PASS.
- Tokens: repair input 14118 — больше spec+impl, потому что в промпте spec + failure output.
- `verification_attempts: 2 | repair_attempts: 1 | repeated_failure: false`
- Wall ~94s

## Open questions для Topic Chat

- Достаточно ли V2 на одном R01, или нужен естественный FAIL без injection?
- Оставлять ли `afterImplementationEpisode` как явный benchmark hook?
