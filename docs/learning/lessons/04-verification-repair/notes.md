# 04 — Verification + bounded Repair

Практический журнал. V2 loop + R01 controlled probe прогнаны и проверены Topic Chat. Теория: `theory.md`.

## Что это за урок одной фразой

Терминальный ответ модели заканчивает **эпизод**, а не workflow. Внешний `npm test` остаётся completion evidence; при FAIL harness нормализует факт и даёт bounded repair.

## Как устроено

```text
SPEC / GATE
→ IMPLEMENT (agent episode; terminal ≠ verified)
→ [R01 only] inject missing-task 404→500 once
→ VERIFY (harness-owned npm test)
   ├─ PASS → verified success
   └─ FAIL
       → normalizeFailure (what failed, not why/how to fix)
       → nextRepairDecision (maxRepairAttempts=2; repeated-failure stop)
       → REPAIR episode (resolved spec + failure evidence + same src-only tools)
       → VERIFY again
```

Команды:

- `cd harness && npm test` — механические тесты без модели
- `cd harness && npm run benchmark:r01` — контролируемый repair probe
- T01–T04 / `benchmark:experiment` в этом модуле сознательно **не** гонялись

Evidence: `docs/learning/lessons/04-verification-repair/traces/`.

## Границы, которые нельзя смешивать

1. **Agent-controlled `npm test`** (`run_command`) — observation для модели.
2. **Harness-controlled verification** — completion authority.
3. **Normalization** — компактный факт (`failedTests`, `500 !== 404`), не diagnosis и не prescribed fix.
4. **Retry policy** — у harness, не у verifier и не у модели.
5. **Repair capability boundary** — write только `target-app/src/`; tests/spec/verifier не доступны для записи.

Fault injection живёт только в R01 (`r01-fault.ts` + `afterImplementationEpisode`). Это benchmark hook, не production behavior.

## R01 — что доказали / что нет

Доказали на одном контролируемом дефекте:

```text
external FAIL
→ normalized evidence
→ repairAttempts=1
→ source repair
→ external PASS
→ verified success
```

Repair получил resolved spec + failure evidence; записал только `tasks/task-routes.ts`.

Не доказали: spontaneous error rate модели, regressions T01–T04, сравнение с V1, repair success rate на разных естественных ошибках, качество verifier coverage.

## Learning-critical code tour

1. `harness/src/run.ts` — `runVerifyRepairLoop`: VERIFY → REPAIR → VERIFY, final workflow status и ownership completion.
2. `harness/src/failure.ts` — `normalizeFailure`: raw verifier output → factual structured evidence.
3. `harness/src/repair.ts` — `nextRepairDecision` / `formatRepairContract`: retry policy и repair context contract.
4. `harness/src/loop.ts` — `runAgentLoop`: implementation/repair episode stop ≠ verified workflow completion.
5. `harness/src/tools.ts` — physical capability boundary; agent-controlled test vs harness verifier.
6. `harness/src/r01-fault.ts` + `run-benchmark.ts` `runRepairProbe` — одноразовый controlled defect для experiment only.

## Наблюдения с R01 (2026-08-18)

- Implementation на зелёном fixture ничего не менял (`changedFiles: []`), затем injection, затем repair вернул 404. Финальный workflow diff пустой — ожидаемо.
- First external verify: FAIL, `500 !== 404`.
- Failure normalization выделила failing test, locations, assertion и signature.
- Repair episode: 4 model / 6 tools; `write_file` только `tasks/task-routes.ts`; затем agent сам запустил `npm test`.
- Harness verifier #2: PASS.
- `verification_attempts: 2 | repair_attempts: 1 | repeated_failure: false`.
- Tokens: total 25383 / 2034; repair 14118 / 1028.
- Wall ~94s.

## Topic Chat review — 2026-08-19

**Verdict:** Module 04 practical goal achieved; no blocking code issues found.

Why sufficient:

- completion authority moved to the outer harness;
- deterministic verifier remains deterministic;
- failure normalization is factual rather than diagnostic;
- repair consumes new external evidence instead of restarting from raw task alone;
- retries are bounded and harness-owned;
- write capabilities protect tests/spec/verifier;
- R01 trace directly demonstrates FAIL → evidence → repair → re-verify → PASS.

Known non-blocking limits:

1. `runV1Harness` is historical naming debt; behavior/trace is V2.
2. Current no-progress detector is intentionally minimal: same failure signature + no source change. It does not detect all oscillation or useless-change patterns.
3. Terminal stop reasons are not yet modeled as a rich lifecycle (`completed / blocked / needs_input / resume`).
4. R01 is a controlled mechanism probe, not a broad reliability eval.

These belong to later eval/orchestration work and do not justify expanding Module 04.

Topic Chat considers Module 04 ready for Master closure / next-module selection.
