# 03 — Context Engineering — Theory Recap

> Цель: восстановить теорию модуля за 3–5 минут. Практические результаты и traces — в `notes.md`, `traces/` и `docs/learning/experiments.md`.

## Core mental model

**Context** — это информация, которую модель фактически видит в конкретный inference (вызов модели): task, instructions, tool schemas, repo excerpts, tool results, spec и история текущего loop.

Важно различать:

```text
environment = всё, к чему agent потенциально имеет доступ
context     = то, что модель видит прямо сейчас
```

Широкий доступ к repository **не** означает, что весь repository уже находится в context.

## Context Engineering vs Prompt Engineering

- **Prompt engineering** — как сформулировать instructions (инструкции) модели.
- **Context engineering** — какую информацию дать модели, когда её дать, откуда она взялась, что переиспользовать и что оставить для поиска по необходимости.

Пример:

```text
Prompt:
"Follow the existing architecture."

Context:
repo map + relevant paths + existing source/tests,
которые позволяют эту architecture увидеть.
```

Хорошая инструкция не заменяет отсутствующую информацию.

## More context != better context

Если дать модели весь repository dump, нужная информация будет внутри, но модели всё равно придётся выделять её среди большого объёма irrelevant (нерелевантного), duplicate (дублирующегося) или stale (устаревшего) материала.

Основные проблемы:

- **irrelevance** — информация верная, но не нужна для текущей задачи;
- **staleness** — информация больше не соответствует текущему состоянию;
- **duplication** — один факт повторяется во многих местах и тратит budget;
- **context pollution** — полезный signal теряется среди лишнего/противоречивого context.

Большое context window — это capacity (ёмкость), а не обязанность заполнять его целиком.

## Context lifecycle

Context меняется по ходу agent loop:

```text
task + instructions + tool schemas
  ↓
list/read result
  ↓
ещё один read result
  ↓
test output / error
  ↓
следующий inference видит уже больший context
```

Для длинных runs приходится думать не только о начальной загрузке, но и о том, что добавлять, переиспользовать, обновлять, сжимать или переставать тащить дальше.

В Module 03 мы решали только раннюю часть lifecycle: initial orientation + reuse между spec и implementation.

## Progressive disclosure

**Progressive disclosure (постепенное раскрытие контекста)** — дать небольшой полезный starting context (начальный контекст), а детали открывать on demand (по мере необходимости).

Не две крайности:

```text
A: task + ничего → agent всё ищет с нуля
B: task + весь repo dump
```

А hybrid (гибрид):

```text
small repo orientation
+ known useful paths
+ normal list/read tools for further discovery
```

Это даёт agent head start (фору / хороший старт), но сохраняет **escape hatch (запасной путь)**: возможность выйти за первоначально выбранный context.

## Eager vs on-demand context

- **eager context (контекст заранее)** — то, что harness кладёт модели до её запроса: task, spec, compact repo map, known relevant paths;
- **on-demand discovery (поиск по необходимости)** — `read_file`, `list_files` и другие reads, которые agent делает после того, как понял, что ему нужно больше информации.

Хороший context layer обычно сочетает оба подхода.

## Repository legibility

**Repository legibility (понятность/читаемость repository для агента)** — насколько легко по структуре, именам, docs и commands понять:

- где API layer;
- где domain logic;
- где tests;
- какие sources authoritative;
- как запускать verification.

Иногда лучший Context Engineering improvement — не retrieval system, а repository, который легче исследовать.

## Targeted context и over-filtering

**Targeted context (целенаправленно выбранный контекст)** должен сокращать search space (пространство поиска), но не создавать ложную границу мира.

Хорошо:

```text
Likely useful starting points:
- src/tasks/task-service.ts
- tests/tasks.test.ts

You may inspect other repository files if needed.
```

Плохо:

```text
These are the only files relevant to the task.
```

**Over-filtering (слишком сильное отсеивание)** опасно: ранняя ошибочная hypothesis (гипотеза) может скрыть contradictory evidence (противоречащие данные) и сделать неверную картину убедительной.

## Context selection != planning

Context layer отвечает:

> "Что полезно показать модели?"

Planner/diagnosis отвечает:

> "Где именно ошибка и как её исправить?"

Поэтому:

```text
"task-service.ts may be relevant"
```

— context hint (подсказка), а

```text
"modify task-service.ts to default to pending"
```

— уже implementation decision / plan и потенциально product invention.

## Authority and provenance

**Provenance (происхождение/источник информации)** отвечает: откуда взялся факт?

**Authority (основание принимать решение)** отвечает: разрешает ли этот source сделать конкретный вывод о требуемом поведении?

Ключевая граница:

```text
finding a repository fact
!=
having authority to choose new product semantics
```

Пример:

```text
Current test:
GET /tasks без status возвращает all tasks.

Это strong evidence текущего behavior.
Но task "hide completed when appropriate" просит изменить behavior.
Текущий test не определяет, КАКИМ новое behavior должно стать.
```

Поэтому retrieval relevance (релевантность найденного материала) сама по себе не создаёт authority.

## Spec context vs implementation context

Фазы задают разные вопросы.

**Spec phase:**

> Что должно быть истинно и достаточно ли authority для execution?

Ей важны current behavior, contracts, tests, docs, provenance и product semantics.

**Implementation phase:**

> Как сделать уже resolved spec истинным?

Ей особенно нужны resolved spec, relevant source paths, types, nearby implementation patterns и tests.

Поэтому полезно переиспользовать orientation между фазами, но необязательно копировать всю spec conversation или полные файлы.

## Reuse != zero rereads

Если spec уже выяснила, что relevant file — `task-service.ts`, implementation может всё равно сделать свежий `read_file(task-service.ts)` перед edit.

Это не обязательно duplicated discovery (повторный поиск). Полезное различие:

```text
bad repeated discovery:
"где вообще нужный код?" → снова list/search/read several files

reasonable fresh read:
"я уже знаю нужный path" → read current contents before edit
```

Цель — уменьшить повторное **figuring out where to look**, а не добиться нулевого числа повторных reads.

## Context budget и tool overhead

Context budget (бюджет контекста) расходуют не только source files:

- instructions;
- task/spec;
- tool schemas;
- repo excerpts;
- tool observations;
- history;
- errors/test logs.

Поэтому даже набор доступных tools является частью Context Engineering: много больших tool schemas может занимать существенную долю input context.

В нашем маленьком harness это пока не bottleneck (узкое место), поэтому tool selection специально не усложняли.

## Наш V1 + context layer

До Module 03 V1 хорошо сохранял resolved **intent**, но почти выбрасывал repository discovery между фазами.

Variant:

```text
raw task
  ↓
buildRepositoryMap()          # deterministic, bounded, no LLM
  ↓
spec phase
  + repo map as orientation
  + on-demand list/read
  + capture inspected paths
  ↓
SpecDecision / existing SDD gate
  ↓ executable
implementation
  + resolved spec (authoritative)
  + repo map (orientation)
  + spec inspected paths (non-exhaustive hints)
  + normal discovery tools still available
  ↓
verification
```

Important semantics:

```text
Spec                         = authoritative execution intent
Repository map               = orientation
Spec-inspected paths         = starting hints, not exhaustive scope
Other repository information = still discoverable on demand
```

## Что подтвердил experiment

На T01–T04 baseline и variant использовали одинаковые task/fixtures/model/tool permissions.

Variant сохранил correctness:

- T01–T03: `executable → PASS`, regressions **0/3**;
- T04: `needs_human_judgment`, implementation **не стартовал**, source changes **none**.

При этом measured discovery уменьшился:

- spec `list_files`: **4 → 0** на каждом task;
- spec model calls: **5 → 2**;
- implementation `list_files` на T01–T03: **1–3 → 0**;
- total input tokens T01–T03: примерно **−13%…−33%**;
- wall time T01–T03: примерно **−23%…−48%**;
- deterministic context preparation была практически бесплатной на этом маленьком repo.

High read overlap между spec и implementation не считается автоматически waste: implementation часто перечитывала уже известные paths для fresh source contents.

### Measurement correction

Исходный experiment также публиковал `implNavCallsBeforeFirstWrite`. Topic Chat review обнаружил instrumentation wiring bug (ошибку подключения метрики): production `runAgentLoop` не передавал `write_file` в `DiscoveryTracker`, поэтому сохранённые значения этого конкретного run нельзя использовать как строгую метрику "до первого write".

Wiring исправлен после review. Основной conclusion experiment от этой метрики не зависит: correctness/T04 safety, `list_files`, model calls, tokens и wall time измерялись независимо.

## Trade-offs / когда ContextBuilder не нужен

Context layer не бесплатен концептуально:

- selection может ошибаться;
- stale map может вести agent не туда;
- hints могут anchor (заякорить) reasoning;
- слишком много eager context снова создаёт pollution;
- сложный retrieval layer может стоить больше, чем сэкономленный discovery.

Если repository небольшой и agent и так стабильно находит нужные места за 1–2 дешёвых reads, отдельный ContextBuilder может быть unnecessary complexity (лишней сложностью).

Добавлять его стоит только если experiment показывает measurable benefit (измеримую пользу).

## Vocabulary

- **context** — информация, которую model реально видит сейчас;
- **progressive disclosure** — постепенное раскрытие деталей по мере необходимости;
- **eager context** — информация, данная заранее;
- **on-demand discovery** — поиск/чтение по необходимости;
- **repository legibility** — насколько repository легко понять и исследовать;
- **targeted context** — специально выбранный релевантный starting context;
- **over-filtering** — слишком сильное отсечение потенциально нужной информации;
- **provenance** — происхождение / источник информации;
- **authority** — основание считать source разрешающим конкретное решение;
- **escape hatch** — возможность выйти за первоначально выбранный context и исследовать дальше.

## Главное запомнить

1. **Environment != active context.** Доступный repo не равен repo, уже находящемуся в prompt/history.
2. Context Engineering — это управление тем, **что модель знает сейчас**, а не просто улучшение wording prompt.
3. **More context != better context**: важны relevance, freshness, provenance и signal-to-noise.
4. Хороший default — **small eager orientation + progressive disclosure + escape hatch**.
5. Context hints не должны превращаться в plan или source of product authority.
6. Reuse должен уменьшать повторное "где смотреть", а не запрещать полезные fresh reads.
7. ContextBuilder нужен только если measured experiment показывает пользу; в нашем harness минимальный variant её показал.
