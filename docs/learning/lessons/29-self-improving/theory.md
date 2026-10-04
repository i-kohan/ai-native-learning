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

After the type-only parent fix, both arms passed the same regression gate, including the live suite. The stop on `fa640a0` was an evidence failure.

The admitted patch is a new `loop-ext/worker-capabilities.ts` of 174 lines. `loop.ts` was not edited, so the proposed boundary is not connected to the loop.

The hidden maintenance grader failed on every H0 and H1 trial. Median core-function and loop-line counts stayed at 0, so the frozen structural rule rejected the candidate. `main` did not move.

## Takeaways

- Candidate generation can be automated. Evaluation, authority, and adoption stay outside the candidate.
- A hidden task is what stops the improver from editing toward the grader.
- An uncommitted patch disappears inside nested worktrees, so the host must materialize a revision without moving the parent branch.
- If the known-good parent fails the regression gate, that is an evidence failure, not a candidate failure.
- Do not move the frozen thresholds after seeing the candidate.
