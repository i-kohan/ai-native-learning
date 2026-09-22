# 22 — Bounded Parallel Fan-Out

## Core question

> Can a frozen two-unit split of genuinely independent work reduce **full end-to-end wall time** when scheduled in parallel, without changing product semantics or the default Spec → one Worker path?

Optimization target: wall-clock of the whole trial (setup → Spec → children → fan-in → final VERIFY → REVIEW).

Not: shorter child interval alone, more agents, or “files were edited in parallel.”

## 1. Mental model

```text
one Spec                 = WHAT must be true
FanOutPlan               = harness-owned process control (who runs, in what order we integrate)
schedule                 = sequential | parallel   (clock only)
child worktree           = isolated HOW for one unit, same exact base SHA
fan-in                   = deterministic Git 3-way of child source deltas
file overlap             ≠ conflict
incompatible hunks       = conflict
```

FanOutPlan is not Spec, not ReviewPlan, and not a second product contract.

fan-out (раздача работы) = start isolated children from one base.  
fan-in (сборка) = put their source deltas back into one integration tree.

## 2. Flow

```text
exact base SHA
→ child A + child B + integration worktrees
→ one Spec on integration
→ bind frozen units A / B
→ schedule children (A then B, or A || B)
→ scoped VERIFY per child
→ apply A, then B, with git apply --3way
→ HEAD stays at base; tree uncommitted
→ final VERIFY + independent REVIEW
```

Child success is harness VERIFY, not a Worker claim. Parallel settles both children; no cancel. Concurrency is fixed at 2.

## 3. Boundaries

- Default architecture stays Spec → one Worker.
- Units must be independent (`dependsOn` empty). `maxParallelWorkers` is 2.
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
3. P03 title + delete is product-independent and file-coupled: children often PASS, then conflict in `task-service.ts`.
4. PAR01: sequential expected 0/3, parallel 2/3, wall ~59s vs ~57s, parallel more expensive → `not_worth_current_workload`.

## 6. Takeaways

- One Spec, two workers, one schedule seam. Not two Specs.
- Schedule changes the clock, not the merge rule (always A, then B).
- File overlap is normal; hunk conflict is the stop.
- Mechanism working ≠ adopt it.
- This P03 workload does not justify making fan-out the default.
