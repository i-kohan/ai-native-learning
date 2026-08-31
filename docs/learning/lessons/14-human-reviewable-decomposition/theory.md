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

## 2. Three authorities

```text
Spec                 = WHAT must be true (product contract; still includes later units)
ReviewPlan           = advisory how a human might review the change
UnitExecutionScope   = harness-owned: implement only this unit in this episode
Worker               = HOW to implement against the Spec, inside that episode scope
Harness              = whether the next unit / phase may run
```

ReviewPlan must not add product semantics, permissions, or success criteria.

`UnitExecutionScope` is process control, not a mini-Spec. Later units stay required by the final Spec; they must not be implemented in the current episode.

`single_change` is a first-class valid outcome. P01 is the negative example: a split can be imagined, but the workload is too small/cohesive for an extra review boundary.

## 3. Actual unit diffs, not labels

Labeling regions of one final diff is not decomposition.

The variant produces sequential source snapshots:

```text
base → A → B → C
unit diffs: base..A, A..B, B..C
```

After each unit: scoped verification is a hard gate; a FAIL stops later units. Final full VERIFY and independent REVIEW still run.

No stacked PRs, DAG scheduler, parallel workers, or LLM Review Planner in this probe. The ReviewPlan is bound manually to the resolved Spec. Shared Spec.acceptance ownership is valid; missing coverage is not.

## 4. When it can be useful

Only if all of these hold:

1. correctness is preserved;
2. actual units are materially easier for a human to review;
3. boundaries are semantic, not file-based;
4. dependencies are explicit;
5. intermediate states remain valid;
6. no acceptance criteria are lost;
7. extra cost is recorded, but does not auto-reject when genuine review surfaces exist.

Human reviewability is not an LLM score. Topic Chat supplies that signal. Default stays Spec → one Worker until that review happens.

## 5. P02 observations

**First experiment.** Quality equal (3/3, first VERIFY PASS, no repairs). Variant ~2× calls/tokens. Advisory ReviewPlan plus “implement only this unit” did **not** materialize review boundaries: Worker A, given the full Spec, implemented the whole feature. B empty 3/3; C empty 2/3.

**Corrected experiment.** Same quality (3/3, first VERIFY PASS, 0 repairs). Variant still ~2× cost. With harness-owned `UnitExecutionScope`, units produced real `base..A`, `A..B`, `B..C` diffs (empty later units: 0). Intermediate VERIFY always PASS. Decision: `candidate_pending_human_review`. Not auto-adopted.

## Takeaways (pre-review)

- Decomposition is for human attention, not agent count.
- Spec ≠ ReviewPlan ≠ UnitExecutionScope.
- Real sequential diffs beat labeled regions of one diff.
- An advisory split does not force sequential implementation unless the harness owns episode scope.
- Extra cost does not auto-reject when genuine review surfaces exist; Topic Chat still owns adoption.
- `single_change` is a legitimate result.
- Mechanism correctness ≠ adoption.
