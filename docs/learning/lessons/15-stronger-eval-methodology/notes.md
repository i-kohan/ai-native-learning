# 15 — Stronger Eval Methodology

Практический журнал. Инфраструктура собрана на DEV/synthetic fixtures, H01/H02 заморожены, калибровка детерминированная, qualification protocol прогнан один раз. Topic Chat ещё не закрывал модуль.

## Что это за урок одной фразой

Не строить новый benchmark platform: отделить DEV от HOLDOUT, дать holdout независимый grader после VERIFY, считать 3/3 как observed count и применять заранее замороженное правило.

## Команды

```text
cd harness && npm test
cd harness && npm run benchmark:qualify
```

- unit tests / calibration: без модели
- qualification: T01–T04 ×1 + H01 ×3 + H02 ×3, isolated worktree per trial
- artifacts: `evals/*.json` / `evals/*.txt` (gitignore)
- lesson copies: `docs/learning/lessons/15-stronger-eval-methodology/traces/`

`--eval` (fixed-v3-m09 6/6 + probes) не смешивается с `--qualify`.

## Файлы, которые стоит лично просмотреть

1. `harness/src/eval/catalog.ts` — `dev` / `holdout` / `probe`, contamination lifecycle
2. `harness/src/eval/grader.ts` — host-owned grader после terminal outcome
3. `harness/src/eval/qualify.ts` — замороженное decision rule
4. `harness/src/eval/qualification-run.ts` — protocol: T01–T04 + H01/H02 ×3
5. `harness/src/run-benchmark.ts` — `prepareHoldout` / `executeHoldoutTrial` (grader до cleanup)

Поток:

```text
createWorkspace
→ restore fixture (no grader in target-app)
→ Spec / Worker / VERIFY / REVIEW
→ runIndependentGrader(host grader, final workspace)
→ normalize escapedDefect
→ cleanup
```

## H01 / H02

Оба на существующем task-app fixture, без видимых feature-тестов в VERIFY.

- **H01** — `PATCH /tasks/:id` title: trim, 400/404, preserve `status`/`completedAt`, list + status filter still work
- **H02** — `DELETE /tasks/:id`: 204, subsequent GET/list/filter/complete/reopen 404, pending and completed

Скрытые grader tests — дополнительные cases тех же требований, не hidden requirements. Worker tools ограничены `target-app/`; grader живёт в `benchmarks/H0x/grader/` на host.

## Калибровка (детерминированная)

`calibrateHoldoutGraders()`:

| Case | Expected | Result |
| --- | --- | --- |
| H01 `correct/patch-title` | PASS | PASS, stable rerun |
| H01 `defects/no-trim` | FAIL | FAIL |
| H01 `defects/mutates-lifecycle` | FAIL | FAIL |
| H01 `defects/missing-is-200` | FAIL | FAIL |
| H02 `correct/delete-task` | PASS | PASS, stable rerun |
| H02 `defects/missing-is-200` | FAIL | FAIL |
| H02 `defects/no-op-delete` | FAIL | FAIL |
| H02 `defects/wrong-success-status` | FAIL | FAIL |

Calibration valid. Это не LLM-прогон и не тюнинг harness.

## Qualification (один прогон, 2026-09-07)

Model: `gpt-5.6-luna`. Base revision: `a6b8e50012980cb79df820c1555c1211a1d76c94`. Suite: `qualification-m15`. Invalid trials: 0. Contamination: none. H01/H02 still `fresh_holdout`.

### T01–T04

| Task | expected | first pass | notes |
| --- | --- | --- | --- |
| T01 | yes | yes | VERIFY PASS |
| T02 | yes | yes | VERIFY PASS |
| T03 | yes | yes | VERIFY PASS |
| T04 | yes | n/a | escalated, no impl |

### H01 trials (independent grader)

| Trial | verify | grader | escaped | wall | calls | tools | tok in/out |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | PASS | PASS | false | 41556 | 8 | 16 | 27549 / 3284 |
| 2 | PASS | PASS | false | 37431 | 8 | 18 | 26678 / 3075 |
| 3 | PASS | PASS | false | 74635 | 11 | 21 | 44651 / 4799 |

Independent grader **3/3**. Median wall 41556 (37431–74635). Median model calls 8 (8–11). Median tool calls 18 (16–21).

### H02 trials (independent grader)

| Trial | verify | grader | escaped | wall | calls | tools | tok in/out |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | PASS | PASS | false | 30034 | 8 | 16 | 24480 / 2509 |
| 2 | PASS | PASS | false | 41537 | 9 | 16 | 33871 / 3008 |
| 3 | PASS | PASS | false | 38464 | 7 | 17 | 23493 / 2870 |

Independent grader **3/3**. Median wall 38464 (30034–41537). Median model calls 8 (7–9). Median tool calls 16 (16–17).

### Verdict

```text
claimSupported = yes
verdict        = supported
escaped        = 0/6
calibration    = valid
```

`3/3` — observed count на этом workload и model snapshot. Это не 100% reliability.

Evidence: `traces/2026-09-07T17-26-05-593Z.txt`

## Caveats

1. Task/grader files были заморожены на host working tree до LLM-прогона. Workspace брал committed fixture SHA; graders читались с host, не из worktree `benchmarks/`.
2. Qualification **не** включает R01/REV01/ISO01/SEC01 — они остаются в `--eval`, в другом знаменателе.
3. H01 trial 3 заметно дороже (74s / 11 calls). Разброс виден в range; median его не прячет.
4. Если эти holdout результаты использовать, чтобы чинить/тюнить harness, H01/H02 станут DEV. Сейчас не использовались.
5. Независимый grader — credible boundary, не security fortress.

## Personal takeaways

- VERIFY PASS на зелёном fixture ничего не говорит про новую фичу, пока нет независимого grader.
- `escapedDefect=null` на T01–T04 остаётся правильным: там нет второй истины.
- Правило надо кодировать до цифр. `2/3` нельзя назвать inconclusive «потому что n маленький».
