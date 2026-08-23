# 08 — Worktrees / Isolation

Практический журнал. Минимальный per-run Git worktree поверх неизменённого V3. ISO01 и fixed suite прогнаны. Модуль **не закрыт** — нужен Topic Chat review.

## Что это за урок одной фразой

Два run из одного exact SHA должны иметь независимый mutable source, а tools/verifier — работать против своего workspace, не против shared checkout.

## Как устроено

```text
resolve C0
→ git worktree add --detach .worktrees/<id> C0
→ bindConfig: repoRoot/targetAppRoot/targetSrcRoot → worktree
→ tracesDir остаётся на host
→ fixture/setup/verify внутри workspace
→ existing V3
→ git worktree remove --force + prune (идемпотентно)
```

Команды:

- `cd harness && npm test`
- `cd harness && npm run benchmark:iso01`
- `cd harness && npm run benchmark:eval`
- lesson copies: `docs/learning/lessons/08-worktrees-isolation/traces/`

## Файлы, которые стоит лично посмотреть

1. `harness/src/workspace.ts` — identity, create, cleanup, bind
2. `harness/src/iso01.ts` — ground truth A/B + verifier FAIL/PASS
3. `harness/src/run-benchmark.ts` — `withIsolatedWorkspace`, fixture больше не трогает main `target-app/src`
4. `harness/src/eval/aggregate.ts` + `report.ts` — ISO01 отдельно от capability 6/6
5. `traces/ISO01-isolation-2026-08-23T11-06-42-372Z.json` и T01 `run_started.workspace`

Поток: `createWorkspace` → `bindConfig` → `prepareBenchmark(config)` / `runV1Harness({ workspace })` → `cleanupWorkspace`.

## ISO01 ground truth (2026-08-23)

C0 = `e5d77788c5ac69ebca6336447156ae292e4a4029`

| Check                             | Result                                     |
| --------------------------------- | ------------------------------------------ |
| A и B записывают C0               | yes                                        |
| source initially equivalent       | yes                                        |
| mutate only A (`getTask` 404→500) | yes                                        |
| A observes mutation               | yes                                        |
| B does not                        | yes                                        |
| main checkout unchanged           | yes                                        |
| verifier A                        | FAIL (`500 !== 404` in A's worktree tests) |
| verifier B                        | PASS                                       |
| cleanup + retry                   | yes                                        |

Это mechanism probe, не capability task.

## V3 regression (fixed-v3-m08)

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed V3 contracts      6 / 6
ISO01                       PASS (Isolation, not 6/6)
Hard regressions            none
```

T01–T04 traces содержат `workspace.root` / `baseRevision`. Skills по-прежнему только на R01/REV01.

## Нюансы

- Worktree берёт committed tree C0, не dirty working tree. Harness process при этом запускается с host (текущий код).
- `node_modules` в worktree нет; делаем symlink на host `target-app/node_modules`. Изолируется source, не install.
- traces/evals живут на host, поэтому cleanup worktree не стирает evidence.
- Skills и `benchmarks/` читаются из workspace revision.
- `npm start` (ручной путь) по-прежнему на main checkout. Изоляция — benchmark/eval.
- Cleanup идемпотентен: второй `cleanupWorkspace` не падает.

## Personal takeaways

- Isolation — это binding roots, не новый agent loop.
- Доказательство изоляции должно быть verifier-observable (FAIL vs PASS), не только «другой cwd».
- Mechanism probe нельзя класть в capability denominator.
- Worktree ≠ sandbox. Это filesystem/git isolation для task state.
