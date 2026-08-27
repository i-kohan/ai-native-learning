# 12 — Planner / Worker / Reviewer

Практический журнал Module 12. Conceptual material живёт в [`theory.md`](./theory.md); здесь — только implementation, experiment и evidence.

**Status:** ✅ completed — implementation, controlled experiment, review fixes, fixed regression и understanding check завершены.

## Что построили

```text
BASELINE: Spec → Worker (implicit planning) → VERIFY / REVIEW
VARIANT:  Spec → read-only Planner → advisory Plan → Worker → same VERIFY / REVIEW
```

- `harness/src/plan.ts` — Plan schema, deterministic admission, Worker handoff, `likelyFiles ≠ edit scope`;
- `harness/src/planner-phase.ts` — отдельный read-only Planner episode;
- `harness/src/run.ts` — optional `Spec → Planner → Worker`, `planningEnabled=false` по умолчанию;
- Reviewer contract не изменён: Plan / Planner rationale / Worker conversation туда не передаются;
- `benchmarks/P01/` — controlled planning-sensitive priority task;
- `npm run benchmark:planning` — 3 valid trials × 2 arms.

## Learning-critical files

1. `harness/src/plan.ts` — `Spec > Plan`, Plan admission, Worker handoff.
2. `harness/src/planner-phase.ts` — read-only tool boundary.
3. `harness/src/run.ts` — lifecycle: Spec → optional Planner → Worker; Reviewer без Plan.
4. `harness/src/planning-experiment.ts` — decision rule и end-to-end metrics.
5. `docs/learning/lessons/12-planner-worker-reviewer/traces/planning-m12-2026-08-27T12-46-15-463Z.txt` — raw experiment report.

## Controlled P01 experiment

Task: добавить task priority `"normal" | "high"` через types → service → routes, сохранив status filtering и complete/reopen/`completedAt` semantics.

Constants across arms:

- exact committed base SHA;
- same model;
- `contextMode=variant`;
- `conversationStateMode=manual`;
- same Worker tools;
- same VERIFY / Reviewer / repair budgets;
- isolated worktree per trial.

Contaminated trials: **0**.

| Arm | expected | first VERIFY | repairs | model/tools avg | tokens in/out avg | wall avg | planner | worker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 3/3 | 3/3 PASS | 0 / 0 | 8 / 23 | 36.6k / 3.7k | ~51s | 0 / 0 | 5 / 12 |
| variant | 3/3 | 3/3 PASS | 0 / 0 | 12 / 31 | 56.6k / 5.3k | ~64s | 2 / 8 | 7 / 12 |

Quality одинаковая. Variant дороже по всем собранным end-to-end signals:

```text
model calls    8  → 12
tool calls     23 → 31
input tokens   ~36.6k → ~56.6k
output tokens  ~3.7k  → ~5.3k
wall           ~51s   → ~64s
```

Worker в Variant тоже не стал дешевле.

Predefined rule → **reject explicit Planner for P01**.

Default остаётся:

```text
Spec → Worker
```

Важно: это workload-bounded conclusion, а не доказательство, что Planner бесполезен на больших long-running changes.

### Plan deviation observation

В Variant #2/#3 `likelyFiles` включали tests / `package.json` / `tsconfig`, но Worker их не менял.

Это полезное evidence, что:

```text
likelyFiles = hints
≠
edit authority
```

## Review gap fixes

После ручного review были найдены и исправлены два небольших gap.

### 1. General dependency cycles

Plan admission первоначально запрещал self-dependency и invalid indexes, но не multi-step cycles.

Теперь deterministic admission отклоняет:

```text
A → B → A
A → B → C → A
```

и принимает нормальный acyclic dependency graph.

Это только validation; DAG executor / scheduler не добавлялся.

### 2. Equal-quality efficiency semantics

Первоначальная implementation decision rule могла трактовать любое directional e2e improvement как `candidate`, хотя заранее не было задано, что считается **meaningful** improvement.

Исправлено:

```text
quality equal + clear e2e regression
→ reject

quality equal + conflicting e2e signals
→ inconclusive

quality equal + directionally better e2e,
but no predefined meaningful threshold
→ inconclusive
```

Сравниваются все собранные e2e signals:

- model calls;
- tool calls;
- input tokens;
- output tokens;
- wall time.

Historical P01 artifact не переписывался и не rerun'ился: его `reject` остаётся валидным, потому что Variant был хуже по всем пяти сигналам.

Harness unit tests after fixes: **125 passed**.

## Fixed V3 regression after fixes

Evidence:

`docs/learning/lessons/12-planner-worker-reviewer/traces/2026-08-27T13-21-46-170Z.txt`

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed V3 contracts      6 / 6
ISO01                       PASS
SEC01                       PASS
Hard regressions            none
```

Planner был выключен во fixed regression, поэтому normal architecture осталась неизменной.

## Understanding check

Learner correctly identified that:

- Worker может отклоняться от Plan, потому что Plan advisory, а Spec / repository truth выше по authority;
- Worker-local savings нельзя считать системным выигрышем — Planner overhead нужно учитывать end-to-end;
- explicit Planner потенциально оправдан на больших задачах, где upfront decomposition может уменьшить backtracking / wasted execution;
- Reviewer не должен получать Plan, чтобы не получить anchoring / correlated judgment.

Correction from the check:

```text
Spec   = WHAT must be true
Planner = HOW we currently intend to get there
Worker  = HOW to actually get there given repo reality
```

## Module decision

M12 closes with this engineering choice:

```text
explicit Planner mechanism = implemented and understood
explicit Planner default   = rejected for current feature-sized workload
normal default              = Spec → Worker
```

Revisit explicit planning only when a larger planning-sensitive workload gives evidence that decomposition/reliability gains can repay coordination overhead.
