# 01 — Agent Loop & Harness — Theory Recap

> Цель: восстановить теорию модуля за 3–5 минут. Подробности — в `master-learning-plan.md` / `deep-research-report.md`; практический журнал — в `notes.md` и `traces/`.

## Core mental model

- **Model** — делает inference по контексту: рассуждает и выбирает следующее действие, но сама не меняет реальный repo.
- **Agent** — model, работающая внутри цикла с возможностью действовать через tools и реагировать на observations.
- **Tool** — capability interface (`read_file`, `write_file`, `npm test`), а не сам реальный мир.
- **Environment** — реальное состояние: файлы, repo, runtime, dependencies, процессы, test runner.
- **Harness** — software/control layer вокруг model: запускает loop, исполняет/ограничивает tools, возвращает observations, хранит state/trace и делает external verification.

```text
task
  ↓
model → tool call → harness/tool → environment
  ↑                                ↓
  └──────────── observation ────────┘
```

Короткая формула:

> **Model decides. Harness mediates. Environment tells the truth.**

## Зачем нужен agent loop

Один `model(prompt)` может предложить решение, но не может последовательно проверить гипотезу о реальном repo.

Loop даёт feedback cycle:

```text
reason → act → observe → update hypothesis → act again
```

Поэтому coding agent может найти код, изменить его, увидеть failing test, скорректировать решение и продолжить работу.

## Model-driven vs harness-driven

**Model-driven loop (наш V0):** model сама решает, что делать дальше — читать файл, менять код, запускать tests. Harness в основном обслуживает и ограничивает эти действия.

**Harness-driven workflow:** harness задаёт крупные стадии, например:

```text
ANALYZE → IMPLEMENT → VERIFY → REPAIR → DONE
```

Model решает локальные задачи внутри стадии, но lifecycle контролирует harness.

На практике зрелая система часто гибридная: harness владеет lifecycle, model — uncertain reasoning внутри него.

## Completion ≠ terminal response

В V0 отсутствие tool call означает только:

```text
no tool calls → terminal response → stop loop
```

Это **не доказывает**, что task выполнен. Terminal text может быть `done`, `need clarification`, `blocked` и т.д.

Поэтому harness делает independent final verification. Но даже green tests — только evidence для закодированных требований, а не доказательство правильного product intent.

## Failure taxonomy

- **Model failure** — evidence и tools доступны, но model делает неправильный вывод/фикс.
- **Tool failure** — capability работает неправильно: например, теряет output или неверно пишет файл.
- **Environment failure** — реальная среда не готова: missing dependencies/runtime/service и т.п.
- **Harness failure** — сломан control loop: не вернул tool result модели, неверно завершил run, дал неправильный cwd/capability.
- **Task/spec ambiguity** — нет однозначного правильного product behavior; model может начать угадывать intent.

Всегда ищи **root cause**, а не только симптом.

## Что подтвердил наш V0

- **T01 — simple bug:** PASS, 6 model calls / 12 tool calls. Простой bounded task реально закрывается через loop.
- **T02 — multi-file behavior:** PASS, 6 / 12. Agent нашёл нужный слой и смог собрать локальную mental model из нескольких файлов.
- **T03 — small feature:** PASS, 6 / 12. Executable tests дали достаточный feedback для чётко заданного поведения.
- **T04 — ambiguous intent:** FAIL, 8 / 13. Model придумала default behavior, не запросила clarification как blocker и остановилась при red tests; external verification правильно завалил run.

Отдельное наблюдение T01–T03: agent делал довольно широкий discovery даже для маленьких fixes → context efficiency остаётся будущей проблемой, но не причиной усложнять V0 сейчас.

## Главное запомнить

1. Coding agent — это не «особая model», а **model + loop + tools/environment через harness**.
2. Tools задают не только удобство, но и **capability/policy boundary**.
3. **Terminal response ≠ done**; external verification должна быть независимой от текста model.
4. Tests проверяют encoded behavior, но не решают ambiguity product intent.
5. Harness стоит усложнять только в ответ на наблюдаемые failure modes, а не заранее.
