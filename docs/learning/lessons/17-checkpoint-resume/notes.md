# 17 — Checkpoint / Resume

Практический журнал Module 17. Формальное закрытие остаётся Topic Chat.

**Status:** implemented and measured. CHK01 **passed**. Not marked complete; Topic Chat owns formal closure.

## Что построили

Второй semantic durable checkpoint:

```text
implementation_ready
→ Worker
→ VERIFY PASS
→ persist review_ready
→ fresh process
→ validate B
→ reconstruct review input from baseline A
→ skip Worker + pre-review VERIFY
→ REVIEW
→ terminal
```

## Learning-critical files

1. `harness/src/workflow-state.ts` — `review_ready` + `admitReviewReady`.
2. `harness/src/review-baseline.ts` — durable pre-Worker `FileSnapshot` artifact.
3. `harness/src/run.ts` — persist after VERIFY PASS; `continueAfterVerifiedImplementation`.
4. `harness/src/checkpoint-probe.ts` — CHK01 control + seed/A/B processes.
5. `harness/tests/checkpoint.test.ts` — admission, baseline integrity, B→C fail-closed.

## Persistence distinction

```text
VERIFY PASS                 = in-process phase result
review_ready persisted      = checkpoint completed
```

Crash before persist keeps `implementation_ready`. If the workspace no longer matches that checkpoint, fail closed. No reconciliation.

## CHK01 recorded run (2026-09-12)

Command: `npm run benchmark:chk01`

Task: T02 DEV. Seed reaches `implementation_ready`; A continues to `review_ready`; B resumes REVIEW.

| Arm | pid | start → exit | Worker | pre-review VERIFY | REVIEW | expected |
| --- | ---: | --- | --- | --- | --- | --- |
| Control | 39758 | spec_required → terminal | yes | PASS | pass | yes |
| A | 41111 | implementation_ready → review_ready | yes | PASS | skipped | checkpoint |
| B | 41457 | review_ready → terminal | skipped | skipped | pass | yes |

Same interrupted workflow ID. Distinct PIDs. B reconstructed `tasks/task-service.ts` from baseline A vs verified B. Negative unit test: mutate B→C → `workspace_mismatch`, no `review_started`.

Evidence: `docs/learning/lessons/17-checkpoint-resume/traces/CHK01-checkpoint-2026-09-12T17-46-34-317Z.txt`

Harness unit tests: **200 passed**.

## Commands

```bash
cd harness && npm test
cd harness && npm run benchmark:chk01
```

## Non-goals kept out

No retry taxonomy, idempotency keys, exactly-once, mid-Worker/VERIFY checkpoints, event sourcing, or Temporal/leases.
