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

Harness after the bind/apply fixes: **272 passed**.

## Bind mistake

Первый live прогон умер на `fan_out_plan_invalid`. `owns()` искал подстроки (`delete` ≠ `Deleting` / `deletion`; «compiles and all tests pass» никто не брал).

Это не проверка Spec. Это раскладка фраз модели на A/B. Для P03 раскладка продукта и так известна. Сейчас весь `acceptance` shared обоим unit. Скоуп рабочего — «делай только этот unit» + его test files.

## Fan-in mistake

`restoreFixture` сносит `target-app/src` и копирует fixture **на диск**, не обновляя index. `git apply --3way` требует index = working tree. Первый патч (unit A) орал `does not match index` — это не conflict A с B.

Фикс: перед apply `git add -A -- target-app/src`. `.gitignore` на `.worktrees/` только прячет папки от `git status` в корне.

## PAR01 (2026-09-22)

Constants: `contextMode=variant`, `conversationStateMode=manual`. Valid 3/3 + 3/3.

Evidence: `traces/fanout-m22-par01-2026-09-22T20-18-39-907Z.txt`

| Arm        | expected | correctness | median wall | median tokens in/out | median child interval |
| ---------- | -------- | ----------- | ----------- | -------------------- | --------------------- |
| sequential | 0/3      | 0/3         | 59199ms     | 47586 / 5146         | 43835ms               |
| parallel   | 2/3      | 2/3         | 56915ms     | 61487 / 5435         | 38336ms               |

Sequential: (1) Spec escalate 400-vs-404 на unknown id + invalid title; (2)(3) A/B VERIFY PASS, real conflict в `task-service.ts`.  
Parallel: два полных success (VERIFY + REVIEW), один тот же conflict.

Wall не −20%. Parallel дороже. `childInterval` короче недостаточно. Conclusion: **`not_worth_current_workload`**. `defaultUnchanged=true`.

0/3 vs 2/3 — не «parallel лучше мержит». Каждый trial — новый Spec и новые патчи. Склейка всегда A, потом B. Повезло с hunks.

## Open

Topic Chat / Master владеют закрытием. Не принимать fan-out в default с этого P03.
