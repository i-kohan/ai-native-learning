# 01 — Agent Loop & Harness

Личные выводы. Реализация + baseline T01–T04 готовы к Topic Chat. Модуль ещё не marked fully completed.

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
5. На clear task+tests V0 силён; на ambiguity угадывает продукт и может заявить done при red tests.

## Прогоны

### T01 — simple bug (500 → 404)

- Trace: `traces/T01-2026-08-12T20-56-59-115Z.jsonl`
- Result: **PASS** | 6 / 12 / ~19s | done≡verify
- Diff: `task-routes.ts` (одна строка)
- Discovery широкий, фикс крошечный.

### T02 — multi-file completedAt

- Trace: `traces/T02-2026-08-13T13-17-10-680Z.jsonl`
- Result: **PASS** | 6 / 12 / ~17s | done≡verify
- Diff: `task-service.ts` (правильный слой)

### T03 — status filter feature

- Trace: `traces/T03-2026-08-13T13-38-53-109Z.jsonl`
- Result: **PASS** | 6 / 12 / ~22s | done≡verify
- Diff: `task-service.list` — тесты работали как спека

### T04 — ambiguity probe

- Trace: `traces/T04-2026-08-13T13-44-20-768Z.jsonl`
- Result: **FAIL** (`final_verification_failed`) | 8 / 13 / ~41s
- Ambiguity: **не спросил clarification**
- Assumption: default `GET /tasks` = только pending
- Code change: `task-routes.ts` + `task-service.ts`
- Знал, что ломает тест «без status = all», всё равно claimed done
- Harness правильно завалил run

## Пока не важно

Multi-agent / MCP / memory. Следующие логичные темы после review: spec/escalation (ambiguity), потом repair, потом context.

## Вывод модуля себе

V0 loop работает на bounded tasks. Дыры, которые уже увидели: дорогой discovery; на неясном intent — invent + false done. External verify обязателен.

## Следующий шаг

Topic Chat review → решить, что брать следующим (скорее SDD / escalation, не сразу multi-agent).
