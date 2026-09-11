# 16 — Durable Execution

Практический журнал Module 16. Формальное закрытие остаётся Topic Chat.

**Status:** implemented and measured. Initial DUR01 passed. **Not marked complete; post-review hardening/rerun pending.**

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

Local JSON under `traces/workflows/`. Checkpoint считается завершённым только после успешного `rename`. Нет `fsync`, WAL или claim про power-loss durability.

Trace JSONL и `previous_response_id` не являются WorkflowState.

## Workspace validation boundary

Benchmark `setup.patch` оставляет uncommitted source, который не представлен `baseRevision`.

Поэтому resume проверяет:

- workspace root still exists (no replacement worktree);
- `HEAD` matches persisted `headRevision` and `baseRevision`;
- SHA-256 fingerprint of `target-app/src` matches the tree captured after fixture setup.

Не проверяем clean git status. Не создаём replacement workspace.

Fingerprint `target-app/src` достаточен для bounded T02 probe, но не является универсальным full-workspace/environment integrity proof.

## DUR01 initial recorded run

Command: `npm run benchmark:dur01`

Task: T02 DEV. Holdout unused.

| Arm | pid | start → exit | Spec calls | VERIFY | REVIEW |
| --- | ---: | --- | ---: | --- | --- |
| Control | 89678 | spec_required → terminal | 2 | PASS | pass |
| A | 91015 | spec_required → implementation_ready | 2 | n/a | skipped |
| B | 91509 | implementation_ready → terminal | 0 | PASS | pass |

Same interrupted workflow ID. Spec once across A+B. Workspace `e38407f1029e` reused.

Evidence: `docs/learning/lessons/16-durable-execution/traces/DUR01-durable-2026-09-11T10-12-56-353Z.txt`

Harness unit tests on the initial implementation: **187 passed**.

## Topic Chat review — 2026-09-11

Overall architecture review: the first durable boundary is sound.

Confirmed:

- `WorkflowState` is small and semantic rather than a serialized `HarnessRunResult`;
- `implementation_ready` contains the admitted Spec and only small handoff/context data;
- resume enters the shared post-Spec executor and does not rerun `buildSpec()`;
- repository map is recomputed rather than made authoritative durable state;
- temp-file → rename persistence is correctly scoped as local process-crash protection, without overclaiming power-loss durability;
- missing/corrupt/unsupported state and workspace mismatch fail closed;
- process A/B evidence demonstrates a real fresh-process boundary;
- existing VERIFY and independent REVIEW still determine workflow success in the recorded run.

### Review finding 1 — transition admission hardening

`admitTerminal()` originally rejected only transitions *from* terminal, so its public transition API technically allowed:

```text
spec_required → terminal(success)
```

Even though `run.ts` did not exercise that path, the state-machine admission API was weaker than the intended authority model.

Hardened after review:

```text
spec_required → terminal(failure / needs_human_judgment) = allowed
spec_required → terminal(success)                       = illegal
implementation_ready → terminal(...)                    = allowed
terminal → anything                                     = illegal
```

This keeps success downstream of an admitted executable Spec and the implementation/verification path.

### Review finding 2 — DUR01 decision rule is stricter than its code assertion

The written decision rule says:

```text
Worker → VERIFY → REVIEW authority remains unchanged
```

The recorded evidence does contain independent `REVIEW=pass`, but the current `workerVerifyReviewUnchanged` boolean only requires:

```text
workerStarted && VERIFY PASS
```

So the initial run supports the claim empirically, but the executable PASS rule should also require `reviewOutcomes` to contain `pass` (and preferably the arm-level expected outcome should require `finalReviewerOutcome === "pass"`).

**Closure rule:** harden that assertion, rerun unit tests + DUR01, then record fresh evidence before marking Module 16 complete.

## Failure semantics covered

- missing / corrupt / unsupported schema or phase
- illegal transition
- terminal resume
- workspace missing / fingerprint mismatch
- crash before persist → previous phase remains authoritative
- crash after persist → resume must not rerun Spec

## Intentionally deferred

- mid-Worker crash / idempotency
- reconciliation of arbitrary external side effects
- Temporal, queues, databases, leases / stale-worker fencing
- durable Planner/Subagent/ReviewPlan
- generalized checkpoint/resume
- power-loss durability
- full workspace/environment fingerprinting
- making `runV1Harness()` durable by default
