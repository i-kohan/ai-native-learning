# 22 — Bounded Parallel Fan-Out

## Core question

> Can a frozen two-unit split of genuinely independent work reduce **full end-to-end wall time** when scheduled in parallel, without changing product semantics or the default Spec → one Worker path?

Optimization target for PAR01: wall-clock of each **scheduling trial** (workspace/fixture setup → children + scoped VERIFY → fan-in → final VERIFY → REVIEW). The executable Spec is resolved once before the 3×2 comparison and reused unchanged, so Spec-generation variance is intentionally outside the per-trial timing window. In a production decision, one-time planning/spec overhead would still belong in broader end-to-end economics.

Not: shorter child interval alone, more agents, or “files were edited in parallel.”

## 1. Mental model

```text
one Spec                 = WHAT must be true
FanOutPlan               = harness-owned process control (who runs, in what order we integrate)
schedule                 = sequential | parallel   (clock only)
child worktree           = isolated HOW for one unit, same exact base SHA
fan-in                   = deterministic Git 3-way of child source deltas
file overlap             ≠ conflict
non-composable deltas      = integration conflict
```

FanOutPlan is not Spec, not ReviewPlan, and not a second product contract.

fan-out (раздача работы) = start isolated children from one base.  
fan-in (сборка) = put their source deltas back into one integration tree.

## 2. Flow

```text
resolve HEAD → frozenBaseRevision once
→ resolve executable Spec once on that SHA
→ exact same SHA + same prepared fixture for every trial
→ child A + child B + integration worktrees
→ bind the same frozen Spec / units A / B
→ schedule children (A then B, or A || B)
→ scoped VERIFY per child
→ apply A, then B, with git apply --3way
→ HEAD stays at base; tree uncommitted
→ final VERIFY + independent REVIEW
```

Child success is harness VERIFY, not a Worker claim. Parallel settles both children; no cancel. Concurrency is fixed at 2.

## 3. Boundaries

- Default architecture stays Spec → one Worker.
- Admission requires `dependsOn` empty and exactly two units, but that only proves **declared** independence. Semantic independence is a workload/design judgment; the harness does not infer it automatically. `maxParallelWorkers` is 2.
- Integration order is a frozen permutation, not an LLM merge.
- Write-set overlap is allowed. Fail only on real 3-way conflict or lost changes.
- Spec gate still wins: `needs_human_judgment` never starts children.

## 4. Failures / trade-offs

- Semantically independent work can still collide in one file.
- Keyword-mapping Spec.acceptance to units tests the parser, not parallelism.
- `--3way` needs index ≈ working tree; fixture rewrite can desync them before any merge.
- Parallel can cost more tokens even when wall time barely moves.
- A shorter child interval is not a PAR01 win.

## 5. What we saw

1. Shared acceptance (both units get the whole Spec list) unblocked bind; scope stayed intent + test files.
2. Syncing index to disk before apply removed false `does not match index` failures.
3. P03 title + delete is semantically independent but integration-coupled: children PASS their scoped VERIFY, yet their source deltas frequently cannot be composed cleanly in `task-service.ts`.
4. First PAR01 had a fresh Spec per trial; the next froze Spec but still resolved HEAD per trial. Current PAR01: one frozen SHA + one Spec, sequential 0/3, parallel 0/3, wall ~56s vs ~38s, parallel more expensive → `not_worth_current_workload`.

## 6. Takeaways

- One Spec, two workers, one schedule seam. Not two Specs.
- Schedule changes the clock, not the merge rule (always A, then B).
- File overlap is normal; the stop condition is a real deterministic integration conflict or lost change, not overlap by itself.
- Mechanism working ≠ adopt it.
- This P03 workload does not justify making fan-out the default.
