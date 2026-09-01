# Module 14 closure — Human-Reviewable Decomposition

Closed by Topic Chat on 2026-09-01.

## Human review signal

The same P02 feature was reviewed as one final change and as sequential semantic units A → B → C.

Observed:

- the whole P02 feature was still small/cohesive enough to fit in one mental model;
- A → B → C was nevertheless clearly easier to understand and review;
- each unit had a coherent local purpose and could be accepted before moving on;
- the improvement was real but modest because P02 is near the lower size/complexity boundary where decomposition may repay its extra cost.

## Final decision

```text
review-decomposition mechanism = implemented + corrected + understood
P02 first experiment           = mechanism_failed / no genuine surfaces
P02 corrected experiment       = quality preserved + genuine A/B/C surfaces
human review signal            = positive, modest on this workload
adoption                       = conditional, not default
normal default                 = Spec → one Worker, single_change first-class
```

## Policy

```text
single_change = default

decompose when:
- the change has multiple genuine semantic concerns;
- each unit has one understandable goal;
- each unit is locally reviewable and verifiable;
- intermediate states remain valid;
- dependencies are explicit;
- reduced human cognitive load repays extra orchestration / verification cost.
```

Do not decompose merely because a change can technically be split, because files can be separated, or because smaller diffs look nicer.

## Evidence

- First experiment: `traces/decomposition-m14-2026-08-29T11-20-11-746Z.txt`
- Corrected experiment: `traces/decomposition-m14-corrected-2026-08-31T12-13-58-044Z.txt`
- Representative human-review artifact: `traces/P02-decomp-v2-variant-1-2026-08-31T12-17-43-955Z.review-units.md`
- Fixed regression after correction: `traces/2026-08-31T12-27-55-652Z.txt`

## Bookkeeping note

`notes.md` and `theory.md` contain the authoritative final Module 14 interpretation. Historical experiment artifacts remain unchanged. If `docs/learning/progress.md` or `docs/learning/experiments.md` still contains a pre-human-review `pending` / `candidate_pending_human_review` line, treat it as stale bookkeeping to synchronize at the next index-only docs update; do not reopen Module 14.
