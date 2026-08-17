# 02 — Spec-Driven Development

Личные выводы. V1 T01–T04 прогнаны; Topic Chat review завершён; модуль готов к формальному закрытию Master.

## Что это за урок одной фразой

Сырая задача не должна сразу идти в coding loop: сначала **read-only spec + классификация ambiguity**, и только `executable` запускает старый V0 loop.

## Как устроено

```text
benchmarks/T0X
  → runV1Harness (run.ts)
      → buildSpec (spec-phase.ts)   # только list_files / read_file / submit_spec
      → enforceSpecDecision (spec.ts)
      → gate
           ├─ executable → runAgentLoop (loop.ts) + npm test
           └─ needs_human_judgment → стоп, файлы не трогаем
```

Команды те же:

- `npm test` — harness + target-app без модели
- `npm run benchmark -- T0X`
- `npm run benchmark:all`

Артефакты прогона: `traces/<id>.jsonl` и `traces/<id>.spec.json`.

## Главное, что запомнить

1. Gate важнее «умного промпта». Смотри `harness/src/run.ts`.
2. Spec-фаза **read-only**. Писать код, пока решается «можно ли кодить», нельзя.
3. `needs_human_judgment` — нормальный outcome, не failure.
4. Structured JSON ≠ истина. Laundering: догадка попадает в `requirements[]` и выглядит как контракт.
5. Текущие тесты — authority для *текущего* поведения и для task, который его явно сохраняет (T03). Они не выбирают новый продукт (T04).
6. Loop по-прежнему V0: spec уходит как текст контракта, не как typed checker.

## Файлы, которые стоит лично просмотреть

1. `harness/src/run.ts` — `runV1Harness`: task → spec → gate → execute/escalate
2. `harness/src/spec.ts` — `Spec`, `SpecDecision`, `enforceSpecDecision`
3. `harness/src/spec-phase.ts` + `spec-instructions.ts` — read-only spec loop
4. `harness/src/tools.ts` — `READ_ONLY_TOOL_DEFINITIONS` / `executeReadOnlyTool`
5. `harness/src/loop.ts` — тот же V0 loop; user message = `formatSpecContract`

## Прогоны V1

### T01 — 500 → 404

- Trace: `traces/T01-2026-08-16T18-12-11-393Z.jsonl` (spec.json ещё не писался)
- `executable` + PASS | 11 / 24 (~5/12 spec) | ~37s
- Diff: одна строка в `task-routes.ts`
- Ambiguity: `repository_resolvable` (404 + body из task/тестов) + `safe_inference`

### T02 — completedAt

- Trace + spec: `.../T02-2026-08-16T18-31-50-810Z`
- `executable` + PASS | 11 / 21 | ~29s
- Diff: `task-service.ts`
- ISO timestamp = `safe_inference`, не escalation

### T03 — status filter

- Trace + spec: `.../T03-2026-08-16T18-32-26-199Z`
- `executable` + PASS | 11 / 21 | ~26s
- Diff: `task-service.ts`
- «без status → все» = `repository_resolvable`, потому что **так написано в task**

### T04 — ambiguity probe

- Trace + spec: `.../T04-2026-08-16T18-30-59-888Z` (повторный прогон уже со spec-артефактом)
- `needs_human_judgment` | impl **нет** | files **none** | 5 / 13 | ~18s
- Вопросы: что значит *when appropriate*; как hiding стыкуется с `?status=completed`
- Default pending **не** выдумали — в отличие от V0

## Что неожиданного не случилось

- Gate не сломал ясные задачи.
- T04 не «прошёл», тихо выбрав pending.
- Эскалация дешевле, чем провальная реализация V0 (~18s vs ~41s).

## Ограничения, которые V1 не закрыл

- Spec laundering нельзя полностью гарантированно поймать: если модель сама запишет придуманную semantics как resolved requirement и не оставит RHJ ambiguity, gate это не докажет.
- Discovery на T01–T03 всё ещё широкий (spec смотрит repo, потом coding loop смотрит снова).
- Terminal response ≠ done внутри coding loop — как в V0.
- Нет repair после красных тестов.

## Вывод себе

V1 делает то, для чего задуман: ambiguity → escalation, clear task → тот же coding agent. Spec — boundary intent/execution, а не бюрократия ради YAML. Дальше не раздувать spec в фреймворк.

## Теория

Короткий refresher: `theory.md`.

## Следующий шаг

Master/Roadmap: прочитать актуальные `progress.md`, `experiments.md` и при необходимости `lessons/02-spec-driven-development/`; формально закрыть Module 02 относительно master plan и выбрать следующий модуль. Не начинать repair/reviewer/context-builder здесь заранее.
