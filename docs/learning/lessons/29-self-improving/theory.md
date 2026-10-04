# 29 — Self-modifying / self-improving systems

## Core question

A harness can propose a patch to itself. The question is who is allowed to decide that the patch is an improvement.

META01 asks one narrower question: can a bounded improver reduce the core loop's coupling to optional Worker capabilities, on one hidden maintenance task, without taking authority over the verdict.

## Mental model

```text
frozen parent H0
→ isolated candidate patch H1
→ host integrity and regression
→ same hidden task on H0 and H1
→ host decision
→ human adoption
```

The improver is not the evaluator. The patch is not the new runtime. A detached `candidateRevision` exists so later worktrees can start from the patch without moving `main`.

## Boundaries

- One candidate. No automatic second attempt.
- Hypothesis before the first write. The hypothesis does not grant admission.
- Writes stay inside `loop.ts` and at most two new files under `loop-ext/`.
- The maintenance task and grader stay outside the improver's read scope.
- Architecture faults count only on the pristine admitted patch, before the maintenance agent edits.
- Invalid provenance rejects the run. It is not an inconclusive success.

## Trade-off

A refactor can make one later change smaller and still be the wrong default. META01 can say `candidate_accepted_for_this_workload`. It cannot say the harness is self-improving.

## Observations

The valid run stopped at H0 `tsc`. Existing type errors on the frozen parent made the live suite and H1 unscored. The stop is an evidence failure.

The improver still produced one bounded patch: a new `loop-ext/capabilities.ts` of 65 lines. It did not edit `loop.ts`, so the proposed plan is not connected to the loop.

Integrity and the detached revision worked. `main` did not move. The candidate was not asked to accept itself.

The first attempt died in the host patch reader before any gate. That crash is not a candidate verdict.

## Takeaways

- Candidate generation can be automated. Evaluation, authority, and adoption stay outside the candidate.
- A hidden task is what stops the improver from editing toward the grader.
- An uncommitted patch disappears inside nested worktrees, so the host must materialize a revision without moving the parent branch.
- If the known-good parent fails the regression gate, that is an evidence failure, not a candidate failure.
- Do not move the frozen thresholds after seeing the candidate.
