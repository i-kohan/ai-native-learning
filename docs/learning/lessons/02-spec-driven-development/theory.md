# 02 — Spec-Driven Development — Theory Recap

> Цель: восстановить теорию модуля за 3–5 минут. Практический журнал и результаты — в `notes.md`, `traces/` и `docs/learning/experiments.md`.

## Core mental model

Raw task — это **intent**, а не обязательно готовая инструкция к implementation.

Spec-driven flow отделяет интерпретацию intent от coding side effects:

```text
raw task
  ↓
read-only spec phase
  ↓
structured SpecDecision
  ├─ executable → coding loop → verification
  └─ needs_human_judgment → escalation, no implementation
```

Короткая формула:

> **Spec определяет, что должно быть истинно; gate решает, достаточно ли authority, чтобы разрешить execution.**

## SDD ≠ длинный PRD

Больше текста не обязательно уменьшает ambiguity.

Хороший spec превращает intent в bounded, verifiable contract:

- `goal` — зачем изменение;
- `requirements` — какое поведение требуется;
- `constraints` — что ограничено/запрещено;
- `non_goals` — что намеренно не решаем;
- `acceptance` — какие наблюдаемые условия должны стать истинными;
- `verification` — как эти условия проверить;
- `ambiguities` — какие вопросы были обнаружены и как классифицированы.

Spec должен уменьшать пространство допустимых решений, но не micromanage обычную implementation discretion.

## Requirement vs acceptance vs verification

- **Requirement** — что система должна делать.
- **Acceptance criterion** — наблюдаемое условие, которое должно быть истинно после implementation.
- **Verification** — механизм, которым мы проверяем acceptance criterion: test, command, API/browser state и т.д.

Пример:

```text
Requirement: missing task returns 404.
Acceptance: request for a missing task produces HTTP 404.
Verification: npm test / relevant route test.
```

## Spec vs plan

- **Spec** — что должно быть истинно независимо от выбранного способа реализации.
- **Plan** — предполагаемые шаги, как этого добиться.

Plan может измениться после просмотра repo; spec при этом может остаться прежним.

## Ambiguity classification

### 1. `repository_resolvable`

Task неполный, но authoritative answer уже можно восстановить из code/tests/docs/contracts/applicable conventions.

Правильное действие: исследовать repo, зафиксировать basis, продолжить автономно.

Важно: repository evidence не всегда repository authority. Текущее legacy behavior само по себе не определяет новый product rule.

### 2. `safe_inference`

Ответ нигде явно не задан, но это low-risk implementation discretion, не создающая material product/security/data/architecture decision.

Примеры: private helper name, локальная структура кода, wording test name.

Правильное действие: infer и продолжить, не эскалировать мелочи человеку.

### 3. `requires_human_judgment`

Есть несколько разумных вариантов, которые создают materially different externally observable behavior или другое существенное решение, а достаточной authority выбрать один из них нет.

Правильное действие: сохранить unresolved question и остановиться **до implementation**.

Полезный heuristic:

> Если два разумных ответа дадут пользователю/API materially разное поведение, а authoritative context не выбирает один из них, это сильный кандидат на human judgment.

## Observable behavior / product semantics

**Observable behavior** — то, что потребитель системы может заметить через внешний контракт: HTTP status/body, UI behavior, public API result, permission behavior, persisted state и т.п.

Выбор `tasks.filter(...)` vs private helper — implementation detail.

Выбор `GET /tasks` возвращает все tasks vs только pending по умолчанию — разные observable product semantics.

Agent может самостоятельно решать ordinary implementation details, но не должен без authority придумывать material product/security/data/architecture semantics.

## Boundary of delegated authority

Agent может:

```text
inspect repo
resolve repository facts
make safe implementation inferences
build a spec
```

Но если доходит до material unresolved decision:

```text
needs_human_judgment
→ explicit question
→ no coding loop
→ no code changes
```

Такой escalation — корректный harness outcome, а не model failure.

## Externalize intent

Для автономии критический intent не должен оставаться только «в голове человека».

```text
implicit human intent
→ explicit structured spec
→ versionable/durable execution contract
```

Человек не обязан вручную писать YAML: можно дать обычный task в 1–2 предложениях, а spec layer сам исследует repo, формирует contract и возвращает только material unresolved decisions человеку.

## Spec laundering

Опасный failure mode:

```text
raw task is ambiguous
→ model guesses a product rule
→ writes guess into requirements[]
→ downstream coding agent treats it as approved truth
```

Пример T04:

```text
"hide completed when appropriate"
→ guess: default = pending
→ spec: "GET /tasks must return pending by default"
```

Structured JSON/YAML не делает statement authoritative автоматически.

Наш V1 gate механически ловит explicit `requires_human_judgment + unresolved`, но не может гарантированно обнаружить laundering, если spec model уже записала выдуманную semantics как resolved requirement. Это остаётся probabilistic limitation spec generation.

## Spec phase must be read-only

Spec phase решает, **можно ли разрешить implementation**, поэтому она не должна сама менять source.

Наш V1 capability boundary:

```text
allowed: list_files, read_file, submit_spec
forbidden: write_file, run implementation commands
```

Gate должен существовать в harness control flow, а не только как инструкция модели.

## Что подтвердил V1 experiment

V0 baseline:

- T01–T03 — PASS на clear bounded tasks;
- T04 — model придумала `default = pending`, изменила code и получила `final_verification_failed`.

V1:

- T01–T03 — `executable → PASS`, clear-task regression **0/3**;
- T04 — `needs_human_judgment`, coding loop **не стартовал**, changed files **none**;
- ambiguous product decision был перехвачен до side effects;
- escalation занял ~18s против ~41s у провальной V0 implementation.

Итог эксперимента:

> **Spec gate перенёс обработку ambiguity раньше в lifecycle: неправильную implementation удалось предотвратить до code changes, не ломая автономию clear tasks.**

## Trade-offs / когда не раздувать SDD

SDD полезен, когда растут ambiguity, autonomy и цена неправильного решения.

Для tiny obvious fix spec может быть несколькими строками. Большой ceremony создаёт bureaucracy, latency и дополнительный model/repository discovery cost.

В нашем V1 spec phase добавляет примерно 5 model calls и повторяет repo discovery. Это ожидаемый trade-off; Context Engineering будет отдельным будущим модулем.

## Главное запомнить

1. **Raw task ≠ execution contract.**
2. SDD — не длинный PRD, а explicit/verifiable boundary между intent и execution.
3. Agent должен сохранять autonomy на `repository_resolvable` и `safe_inference`, но эскалировать material unresolved judgment.
4. **Spec phase read-only; gate before side effects.**
5. `needs_human_judgment` — нормальный workflow outcome.
6. **Structured ≠ authoritative:** spec laundering остаётся реальным failure mode.
7. Spec говорит **что должно быть истинно**; plan — **как этого добиться**.
8. Добавлять spec ceremony стоит пропорционально ambiguity и цене неправильного изменения.
