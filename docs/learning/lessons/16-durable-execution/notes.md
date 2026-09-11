# 16 — Durable Execution

Практический журнал Module 16. `theory.md` — короткий черновик; формальное закрытие остаётся Topic Chat.

**Status:** implemented and measured. DUR01 passed. **Not marked complete.**

## Что построили

Первый bounded durable checkpoint:

```text
spec_required
→ harness admits executable Spec
→ persist implementation_ready
→ process may die
→ fresh process loads WorkflowState
→ validate existing workspace
→ skip Spec
→ Worker → VERIFY → REVIEW
→ persist terminal
```

Это mechanism probe, не production workflow engine и не Module 17.

## Learning-critical files

1. `harness/src/workflow-state.ts` — discriminated WorkflowState + admission.
2. `harness/src/workflow-store.ts` — serialize/validate → temp file → rename.
3. `harness/src/workspace.ts` — `captureWorkspaceResumeEvidence` / `bindResumedWorkspace`.
4. `harness/src/run.ts` — `continueAfterAdmittedSpec`; durable load/resume/stopAfter.
5. `harness/src/durability-probe.ts` — DUR01 control + process A/B.

## Persistence

Local JSON under `traces/workflows/`. Checkpoint считается завершённым только после успешного `rename`. Нет `fsync`, нет claim про power-loss durability.

Trace JSONL и `previous_response_id` не являются WorkflowState.

## Workspace validation boundary

Benchmark `setup.patch` оставляет uncommitted source, который не представлен `baseRevision`.

Поэтому resume проверяет:

- workspace root still exists (no replacement worktree);
- `HEAD` matches persisted `headRevision` and `baseRevision`;
- SHA-256 fingerprint of `target-app/src` matches the tree captured after fixture setup.

Не проверяем clean git status. Не создаём replacement workspace.

## DUR01

Command: `npm run benchmark:dur01`

Task: T02 DEV. Holdout unused.

| Arm | pid | start → exit | Spec calls | VERIFY | REVIEW |
| --- | ---: | --- | ---: | --- | --- |
| Control | 89678 | spec_required → terminal | 2 | PASS | pass |
| A | 91015 | spec_required → implementation_ready | 2 | n/a | skipped |
| B | 91509 | implementation_ready → terminal | 0 | PASS | pass |

Same interrupted workflow ID. Spec once across A+B. Workspace `e38407f1029e` reused.

Evidence: `docs/learning/lessons/16-durable-execution/traces/DUR01-durable-2026-09-11T10-12-56-353Z.txt`

Harness unit tests: **187 passed**.

## Failure semantics covered

- missing / corrupt / unsupported schema or phase
- illegal transition
- terminal resume
- workspace missing / fingerprint mismatch
- crash before persist → previous phase remains authoritative
- crash after persist → resume must not rerun Spec

## Intentionally deferred

- mid-Worker crash / idempotency
- Temporal, queues, databases, leases
- durable Planner/Subagent/ReviewPlan
- Module 17 generalized checkpoint/resume
- making `runV1Harness()` durable by default
