# 15 — Stronger Eval Methodology

Практический журнал. Инфраструктура собрана на DEV/synthetic fixtures, H01/H02 заморожены, калибровка детерминированная, qualification protocol прогнан один раз. Topic Chat review completed; qualification verdict preserved with explicit limitations.

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
2. `harness/src/eval/grader.ts` — host-owned grader after terminal outcome
3. `harness/src/eval/qualify.ts` — frozen qualification decision rule
4. `harness/src/eval/qualification-run.ts` — protocol: T01–T04 + H01/H02 ×3
5. `harness/src/run-benchmark.ts` — `prepareHoldout` / `executeHoldoutTrial` (grader before cleanup)

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

Оба на существующем task-app fixture, без feature-тестов holdout в normal VERIFY.

- **H01** — `PATCH /tasks/:id` title: trim, 400/404, preserve `status`/`completedAt`, list + status filter still work
- **H02** — `DELETE /tasks/:id`: 204, subsequent GET/list/filter/complete/reopen behavior, pending and completed

Скрытые grader tests — дополнительные cases тех же требований, не hidden requirements. Worker tools ограничены `target-app/`; grader живёт в `benchmarks/H0x/grader/` на host и выполняется против staging copy final workspace.

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

Calibration valid. Это не LLM-прогон и не tuning harness.

## Qualification (one run, 2026-09-07)

Model: `gpt-5.6-luna`. Base revision: `a6b8e50012980cb79df820c1555c1211a1d76c94`. Suite: `qualification-m15`. Invalid trials: 0. Contamination: none. H01/H02 still `fresh_holdout`.

### T01–T04

| Task | expected | first pass | notes |
| --- | --- | --- | --- |
| T01 | yes | yes | VERIFY PASS |
| T02 | yes | yes | VERIFY PASS |
| T03 | yes | yes | VERIFY PASS |
| T04 | yes | n/a | escalated, no impl |

### H01 trials

| Trial | verify | grader | expected | escaped | wall | calls | tools | tok in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | PASS | PASS | yes | false | 41556 | 8 | 16 | 27549 / 3284 |
| 2 | PASS | PASS | yes | false | 37431 | 8 | 18 | 26678 / 3075 |
| 3 | PASS | PASS | yes | false | 74635 | 11 | 21 | 44651 / 4799 |

Independent grader **3/3**. Median wall 41556 (37431–74635). Median model calls 8 (8–11). Median tool calls 18 (16–21).

### H02 trials

| Trial | verify | grader | expected | escaped | wall | calls | tools | tok in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | PASS | PASS | yes | false | 30034 | 8 | 16 | 24480 / 2509 |
| 2 | PASS | PASS | yes | false | 41537 | 9 | 16 | 33871 / 3008 |
| 3 | PASS | PASS | yes | false | 38464 | 7 | 17 | 23493 / 2870 |

Independent grader **3/3**. Median wall 38464 (30034–41537). Median model calls 8 (7–9). Median tool calls 16 (16–17).

### Verdict

```text
claimSupported = yes
verdict        = supported
escaped        = 0/6
calibration    = valid
```

`3/3` — observed count on this workload and configured model. It is not a 100% reliability estimate.

Evidence: `traces/2026-09-07T17-26-05-593Z.txt`

## Topic Chat implementation review (2026-09-08)

Verdict: **no blocking correctness issue found for the recorded qualification evidence**. Keep the existing `supported` verdict workload-bounded.

What was confirmed:

1. H01/H02 grader files are host-owned and absent from normal Worker/VERIFY tests.
2. Worker filesystem tools are rooted under `target-app/`; write access is further restricted to `target-app/src/`.
3. The grader runs only after `runV1Harness(...)` returns and before worktree cleanup.
4. The grader copies the final target app into a temporary staging directory and injects benchmark-owned tests there, so the normal workspace is not modified by grading.
5. H01/H02 task text explicitly contains the requirements checked by their hidden tests; no hidden product requirements were found.
6. DEV/HOLDOUT/probe denominators remain separate.
7. Actual six holdout traces all recorded `expected=yes`, `VERIFY PASS`, grader PASS, escaped=false.

Non-blocking methodology limitations to keep explicit:

- only two holdout tasks, both from the same small CRUD/task-app family;
- same configured model name is recorded, but this is not a cryptographically pinned provider snapshot;
- grader PASS/FAIL provenance is normalized, but full grader stdout is not retained as first-class per-trial evidence;
- the current top-level frozen decision code gates on T01–T04 regression + H01/H02 grader 3/3 + escaped defects + calibration. All observed holdout runs also had full `expectedOutcomeMet=yes`, so the verdict is unaffected, but a future qualification suite should make full holdout workflow success an explicit release criterion before seeing outcomes;
- independent grader boundary is credible evaluation isolation, not hostile security isolation.

## Production-scale picture

A mature agent eval system is usually layered rather than one giant benchmark:

```text
versioned regression suite
+ capability/progress suite
+ fresh holdout/canary work
+ reproducible sandboxes
+ multiple trials where stochasticity matters
+ deterministic / static / model / human graders
+ traces + outcome + cost/latency + model/harness provenance
+ predefined release gates
+ production monitoring / A-B / sampled human review
```

For coding agents, SWE-bench-style grading is a useful concrete pattern: the agent gets issue + repo, while evaluation tests remain outside its working loop; fail-to-pass tests verify the requested change and pass-to-pass tests protect existing behavior. Production teams then complement offline evals with real-world monitoring and continuously turn observed failures into DEV/regression cases.

Useful external examples:

- Anthropic, *Demystifying evals for AI agents* — capability vs regression suites, grader types, transcript review, production monitoring/A-B testing; examples from Descript and Bolt.
- SWE-bench Verified — issue/repo tasks with independent test-based evaluation in reproducible environments.
- OpenAI, *Introducing SWE-bench Verified* — human-validated benchmark subset and evaluation harness context.

## Caveats / lifecycle

1. H01/H02 were frozen before the recorded qualification run and were not used to tune the harness afterwards. They therefore remain fresh holdout for that recorded evidence.
2. Once either task steers a harness/mechanism fix, it becomes DEV/known for future qualification.
3. Qualification does **not** include R01/REV01/ISO01/SEC01; they remain separate evaluation categories.
4. H01 trial 3 is visibly more expensive; median + range preserves that variability.
5. Future qualification should replenish fresh holdout coverage rather than repeatedly reusing H01/H02 forever.

## Personal takeaways

- VERIFY PASS on a green fixture does not prove the new requested behavior unless an independent outcome check exists.
- `escapedDefect=null` on T01–T04 is correct because no independent second truth exists there.
- Rules must be frozen before seeing numbers.
- Passing a grader means “passed what this grader checks,” not “software is universally correct.”
- Good production eval is a maintained feedback system, not a one-time score.
