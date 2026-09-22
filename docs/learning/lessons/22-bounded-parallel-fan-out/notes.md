# 22 — Bounded Parallel Fan-Out

Практический журнал Module 22. Conceptual material: [`theory.md`](./theory.md). Принятие — Topic Chat / Master.

**Status:** implemented + PAR01 recorded. **Not closed.** Default remains Spec → one Worker.

## Что построили

```text
DEFAULT:   Spec → one Worker → VERIFY / REVIEW
PROBE:     exact-base worktrees A, B, integration
           → one Spec
           → frozen FanOutPlan (A title, B delete)
           → schedule sequential | parallel
           → scoped child VERIFY
           → Git 3-way fan-in
           → final VERIFY / REVIEW
```

- `benchmarks/P03/` — title mutation + deletion
- `harness/src/fan-out-plan.ts` — schema, admission, shared acceptance bind
- `harness/src/fan-out.ts` — worktrees, schedule, fan-in
- `harness/src/source-delta.ts` — real Git binary/full-index delta + apply
- `harness/src/fanout-experiment.ts` — P03 templates, PAR01 rule
- `npm run benchmark:fanout` / `benchmark:fanout:smoke`

Smoke only checks that A/B/integration share one SHA. It is not PAR01.

## Learning-critical files

1. `harness/src/fan-out-plan.ts` — FanOutPlan ≠ ReviewPlan; bind shares every Spec.acceptance item.
2. `harness/src/fan-out.ts` — exact-base workspaces; sequential vs parallel; deterministic A→B fan-in.
3. `harness/src/source-delta.ts` — capture vs base SHA; `syncIndexToWorktree` before `--3way`.
4. `harness/src/fanout-experiment.ts` — frozen decision rule; P03 unit templates (intent + tests, no `owns`).
5. `harness/src/run.ts` — after executable Spec, fan-out path, then final VERIFY/REVIEW.

## Commands

```text
npm test
npm run benchmark:fanout:smoke
npm run benchmark:fanout
```

Harness after the methodology fix: **278 passed**.

## Bind mistake

Первый live прогон умер на `fan_out_plan_invalid`. `owns()` искал подстроки (`delete` ≠ `Deleting` / `deletion`; «compiles and all tests pass» никто не брал).

Это не проверка Spec. Это раскладка фраз модели на A/B. Для P03 раскладка продукта и так известна. Сейчас весь `acceptance` shared обоим unit. Скоуп рабочего — «делай только этот unit» + его test files.

## Fan-in mistake

`restoreFixture` сносит `target-app/src` и копирует fixture **на диск**, не обновляя index. `git apply --3way` требует index = working tree. Первый патч (unit A) орал `does not match index` — это не conflict A с B.

Фикс: перед apply `git add -A -- target-app/src`. `.gitignore` на `.worktrees/` только прячет папки от `git status` в корне.

## Methodology corrections

- P03: unknown task → 404 even if title is invalid (frozen in `task.md` + test).
- Spec resolves **once**; all 6 trials reuse that executable Spec (`admittedSpec` experiment seam). Default `runV1Harness()` still builds Spec.
- Valid trial = executable Spec + fan-out evidence + expected schedule + both children started. Spec escalate is contaminated.
- Admission: exactly 2 units and `maxParallelWorkers === 2`.
- Metrics: `finalVerifyDurationMs` / `finalReviewDurationMs` from real phases. No leftover `finalGateDurationMs`.
- After `prepareP03`, A/B/integration must share one source fingerprint (same commit + same fixture, not “raw commit tree”).

## PAR01 superseded (invalid)

`traces/fanout-m22-par01-2026-09-22T20-18-39-907Z.txt` — каждый trial писал свой Spec; один sequential был «valid» после `needs_human_judgment`. Не цитировать 0/3 vs 2/3 как текущий результат.

## PAR01 corrected (2026-09-22)

Constants: `contextMode=variant`, `conversationStateMode=manual`. Один frozen Spec `eeafb0b983c52ea7…`. Valid 3/3 + 3/3.

Evidence: `traces/fanout-m22-par01-2026-09-22T20-48-39-502Z.txt`

| Arm        | expected | correctness | median wall | median tokens in/out | median child interval |
| ---------- | -------- | ----------- | ----------- | -------------------- | --------------------- |
| sequential | 0/3      | 0/3         | 49277ms     | 51239 / 4057         | 47647ms               |
| parallel   | 1/3      | 1/3         | 52269ms     | 57446 / 5445         | 44422ms               |

Все шесть trial стартовали A и B. Sequential: 3× conflict в `task-service.ts`. Parallel: 2× conflict, 1 success.

Wall не −20% (parallel даже чуть медленнее). Parallel дороже. Conclusion: **`not_worth_current_workload`**. `defaultUnchanged=true`.

## Open

Topic Chat / Master владеют закрытием. Не принимать fan-out в default с этого P03.
