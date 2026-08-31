# 14 — Human-Reviewable Decomposition

## Core question

The question is not “can we split a change into more agent tasks?”

It is:

> Does **semantic** decomposition of a larger change improve **human reviewability** enough to justify extra execution, verification, and integration cost?

Optimization target: verified software / human attention.

Not: number of agents, number of tasks, smallest diffs, or maximum autonomy.

## 1. Four distinctions

```text
Task decomposition  ≠ agent decomposition
File decomposition  ≠ semantic decomposition
Independent         ≠ reviewable
Small               ≠ good
```

A file slice can be small and still unreviewable. A semantic unit can touch several files and still be easier for a human than one mixed final diff.

## 2. ReviewPlan is advisory

```text
Spec        = WHAT must be true
ReviewPlan  = how we currently propose to review the change
Worker      = HOW to implement against the Spec
Harness     = whether the next phase may run
```

ReviewPlan must not add product semantics, permissions, success criteria, or implementation constraints.

`single_change` is a first-class valid outcome. P01 is the negative example: a split can be imagined, but the workload is too small/cohesive for an extra review boundary.

## 3. Actual unit diffs, not labels

Labeling regions of one final diff is not decomposition.

The variant produces sequential source snapshots:

```text
base → A → B → C
unit diffs: base..A, A..B, B..C
```

After each unit: repository remains valid for completed behavior; bounded unit verification runs; the delta is recorded. Final full VERIFY and independent REVIEW still run.

No stacked PRs, DAG scheduler, parallel workers, or LLM Review Planner in this probe. The ReviewPlan is bound manually to the resolved Spec.

## 4. When it can be useful

Only if all of these hold:

1. correctness is preserved;
2. actual units are materially easier for a human to review;
3. boundaries are semantic, not file-based;
4. dependencies are explicit;
5. intermediate states remain valid;
6. no acceptance criteria are lost;
7. overhead does not erase the human-review benefit.

Human reviewability is not an LLM score. Topic Chat supplies that signal.

## 5. P02 observation

On P02, quality was equal (3/3, first VERIFY PASS, no repairs). Variant cost about 2× model calls and tokens.

The proposed units A (capability) → B (PATCH) → C (overdue) were **not** the actual review surfaces. Worker A, given the full Spec, implemented the whole feature. B was empty 3/3. C was empty 2/3.

So the extra episodes did not create three human-reviewable diffs. They mostly replayed an already-complete repository. The harness recorded that deviation instead of shrinking the Spec.

`single_change` remains the right default for this workload.

## Takeaways (pre-review)

- Decomposition is for human attention, not agent count.
- ReviewPlan ≠ Spec.
- Real sequential diffs beat labeled regions of one diff.
- A written semantic split does not force sequential implementation if the Worker still sees the full Spec.
- `single_change` is a legitimate result.
- Mechanism correctness ≠ adoption.
