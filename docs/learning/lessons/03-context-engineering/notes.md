# 03 — Context Engineering

Практический журнал. Implementation + T01–T04 baseline/variant прогнаны; Topic Chat review ещё не закрывал модуль. `theory.md` пишет Topic Chat после review.

## Что это за урок одной фразой

Spec сохраняет **intent** между фазами, но без отдельного слоя контекста implementation заново ищет, **куда смотреть**. Минимальный слой: compact repo map + пути, которые spec уже прочитал.

## Как устроено

```text
raw task
  → [variant] buildRepositoryMap(target-app)     # context.ts, без модели
  → spec phase
      + map как orientation
      + list_files / read_file on demand
      + capture inspected paths
      → SpecDecision
  → gate (как в V1)
      ├─ needs_human_judgment → стоп
      └─ executable
           → implementation получает:
               - resolved spec (authoritative)
               - repo map (orientation)
               - spec inspected paths (starting hints)
           → list_files / read_file / write_file / run_command как раньше
           → npm test
```

`contextMode=baseline` — прежний V1: map не строится, inspected paths не передаются.

Команды:

- `npm test` — harness без модели
- `npm run benchmark -- T0X` — baseline
- `npm run benchmark -- T0X --variant`
- `npm run benchmark:experiment` — T01–T04, baseline затем variant, fixture каждый раз

Локальные прогоны: `traces/<id>.jsonl` (gitignore).  
Representative copies для GitHub/Topic Chat: `docs/learning/lessons/03-context-engineering/traces/`.

## Семантика контекста

Не смешивать категории:

1. **Spec** — authoritative execution intent.
2. **Repo map** — orientation, не требование.
3. **Spec inspected paths** — полезные starting points, не exhaustive scope.
4. Repository evidence **не** даёт новых product semantics.
5. Implementation может читать любой файл, который разрешают существующие tools.

Hints формулируются как «may be useful starting points», не как «Modify task-service.ts».

## Файлы, которые стоит лично просмотреть

1. `harness/src/context.ts` — `buildRepositoryMap`, `formatSpecPhaseOrientation`, `formatImplementationHints`, `DiscoveryTracker`
2. `harness/src/run.ts` — `runV1Harness`: prep map → spec → gate → reusable context
3. `harness/src/spec-phase.ts` — `buildSpec`: map в user message + capture paths
4. `harness/src/loop.ts` — `runAgentLoop`: hints + полный набор tools
5. `harness/src/run-benchmark.ts` — `runContextExperiment` / `printExperimentSummary`

## Прогоны 2026-08-18

Все 8 runs **expected**. Полная таблица: `docs/learning/experiments.md` § Module 03.

### T01

- baseline: `.../traces/T01-baseline-2026-08-18T09-58-14-349Z`
- variant: `.../traces/T01-variant-2026-08-18T09-58-41-988Z`
- оба `executable` + PASS
- spec model 5→2; spec `list_files` 4→0; impl `list_files` 1→0
- overlap reads: known files (routes/tests), не слепой обход дерева

### T02

- baseline: `.../T02-baseline-2026-08-18T09-59-03-225Z`
- variant: `.../T02-variant-2026-08-18T09-59-45-456Z`
- оба `executable` + PASS
- spec 5→2; impl list 3→0; nav before write 8→5
- wall ~42s → ~26s; tokens in −33%

### T03

- baseline: `.../T03-baseline-2026-08-18T10-00-12-054Z`
- variant: `.../T03-variant-2026-08-18T10-01-01-879Z`
- оба `executable` + PASS
- те же discovery-сдвиги, что у T02
- wall ~49s → ~25s; tokens in −26%

### T04

- baseline: `.../T04-baseline-2026-08-18T10-01-27-710Z`
- variant: `.../T04-variant-2026-08-18T10-02-48-376Z`
- оба `needs_human_judgment`; impl **нет**; changed files **none**
- spec model 5→2; spec `list_files` 4→0
- map + inspected paths **не** превратили ambiguous task в executable

## Что запомнить по результатам

1. Blind discovery — это `list_files` «где вообще лежат файлы», не повторный `read_file` перед edit.
2. Map убил spec-phase listing (4→0) и impl listing (1–3→0). Spec всё равно читает файлы (6–7) — так и задумано.
3. Context prep ~0 ms; overhead не спрятан в ContextBuilder.
4. T01 variant: impl input tokens чуть выросли (hint block), total всё равно ниже.
5. T04 baseline ~80s — outlier latency относительно V1 ~18s; variant T04 ~15s. Не считать это harness regression.

## Что слой контекста не делает

- Не чинит spec laundering.
- Не чинит terminal response ≠ done.
- Не ограничивает tools путями из map.
- Не добавляет embeddings / retrieval / summarizer / repair.

## Вывод себе

Минимальный targeted context на этом harness **полезен** по decision rule: correctness 0/3, T04 safe, меньше blind discovery, prep дешёвый, wall/tokens лучше. `theory.md` — после Topic Chat.

## Следующий шаг

Topic Chat: code tour + traces в `lessons/03-context-engineering/traces/` + `experiments.md`; написать `theory.md`; решить, закрывать ли модуль. Не начинать repair/reviewer заранее.
