# 01 — Agent Loop & Harness

Личные выводы. Baseline T01–T04 + limitation notes готовы к Master close.

## Что это за урок одной фразой

Coding agent = модель внутри цикла **действие → observation → снова модель**, а «готово» проверяет не она, а harness тестами.

## Как устроено (чтобы не путаться)

```text
benchmarks/T0X  → готовит одинаковый старт (fixture + patch)
harness/loop.ts → единственный мозг агента
target-app/     → то, что чинят
traces/         → что реально произошло
```

Команды:

- `npm test` — проверить код без модели
- `npm run benchmark -- T0X` — учебный прогон (обычно это)
- `npm start --prefix harness -- --task "..."` — ручная песочница (редко)

## Главное, что запомнить

1. Loop важнее фреймворков. Смотри `harness/src/loop.ts`.
2. Модель может врать про done → всегда свой `npm test`.
3. Tools = политика (что можно трогать), не «удобный shell».
4. Без trace непонятно, _как_ прошёл success.
5. На clear task+tests V0 силён; на ambiguity угадывает продукт и может остановиться при red tests.
6. **Terminal response ≠ done.** Любой ответ без tool call останавливает loop («готово», «уточни», «blocked» — для V0 одно и то же).

## Прогоны

### T01 — simple bug (500 → 404)

- Trace: `.../traces/T01-2026-08-12T20-56-59-115Z.jsonl`
- Result: **PASS** | 6 / 12 / ~19s | done≡verify
- Diff: `task-routes.ts` (одна строка)
- Discovery широкий, фикс крошечный.

### T02 — multi-file completedAt

- Trace: `.../traces/T02-2026-08-13T13-17-10-680Z.jsonl`
- Result: **PASS** | 6 / 12 / ~17s | done≡verify
- Diff: `task-service.ts` (правильный слой)

### T03 — status filter feature

- Trace: `.../traces/T03-2026-08-13T13-38-53-109Z.jsonl`
- Result: **PASS** | 6 / 12 / ~22s | done≡verify
- Diff: `task-service.list` — тесты работали как спека

### T04 — ambiguity probe

- Trace (lesson copy): `docs/learning/lessons/01-agent-loop-harness/traces/T04-2026-08-13T13-44-20-768Z.jsonl`
- Result: **FAIL** (`final_verification_failed`) | 8 / 13 / ~41s
- Ambiguity: **не спросил clarification как blocker**
- Assumption: default `GET /tasks` = только pending
- Code change: `task-routes.ts` + `task-service.ts`
- Оставил note, что старый тест конфликтует — и всё равно дал terminal response
- Harness завалил run по тестам (правильно)

## Limitation: terminal ≠ done

В V0:

```text
no tool calls → stop loop → receivedTerminalResponse
```

«I fixed it» и «please clarify» выглядят одинаково.  
Если бы на T04 модель только попросила clarify и **не трогала код**, тесты остались бы green → V0 мог бы дать **success**. Это отдельная дыра (нет escalation / intent classification). В коде поле переименовано в `receivedTerminalResponse`, логику escalation в V0 не добавляли.

Representative traces: `docs/learning/lessons/01-agent-loop-harness/traces/`.

## Пока не важно

Multi-agent / MCP / memory. Следующие логичные темы: spec/escalation, потом repair, потом context.

## Вывод модуля себе

V0 loop работает на bounded tasks. Дыры: дорогой discovery; ambiguity → invent + terminal without escalation; terminal response ≠ task done. External verify обязателен, но не достаточен для clarify-only stops.

## Следующий шаг

Отдать Module 01 в Master на формальное закрытие → выбрать следующий модуль (скорее SDD / escalation).
