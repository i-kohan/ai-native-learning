# 16 — Durable Execution

Практический журнал Module 16.

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-11 after implementation review, transition hardening, hardened DUR01 rerun, and understanding check.

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

### Review finding 2 — DUR01 decision rule was stricter than its code assertion

The written decision rule required:

```text
Worker → VERIFY → REVIEW authority remains unchanged
```

The initial recorded evidence did contain independent `REVIEW=pass`, but the first executable `workerVerifyReviewUnchanged` boolean required only Worker + VERIFY PASS.

The assertion was hardened and rerun before closure.

### Hardened DUR01 rerun

Executable PASS now requires independent REVIEW:

```ts
workerVerifyReviewUnchanged:
  interrupted.workerStarted &&
  interrupted.verifyOutcomes.includes("PASS") &&
  interrupted.reviewOutcomes.includes("pass")

expectedOutcomeMet also requires:
  last.finalReviewerOutcome === "pass"
```

Command: `npm run benchmark:dur01`

Harness unit tests: **191 passed**.

| Arm | pid | start → exit | Spec calls | VERIFY | REVIEW |
| --- | ---: | --- | ---: | --- | --- |
| Control | 45299 | spec_required → terminal | 2 | PASS | pass |
| A | 46556 | spec_required → implementation_ready | 2 | n/a | skipped |
| B | 47362 | implementation_ready → terminal | 0 | PASS | pass |

Same interrupted workflow ID. Spec once across A+B. Workspace `b5f17482124e` reused. All executable DUR01 assertions passed, including `workerVerifyReviewUnchanged`.

Evidence: `docs/learning/lessons/16-durable-execution/traces/DUR01-durable-2026-09-11T15-17-19-208Z.txt`

## Understanding check

Final Topic Chat check passed with two clarifications.

The learner correctly identified that:

- `WorkflowState`, not trace history, is the durable workflow authority;
- if `implementation_ready` was not persisted, a fresh process must obey the previous durable phase and rerun Spec;
- a fresh process can resume the same workflow from a persisted semantic boundary with the required workspace/provenance.

Clarifications:

1. `implementation_ready` is a good first checkpoint not only because it stores little state or is early, but because it is **before the first mutating Worker phase**. A later/mid-Worker checkpoint immediately introduces idempotency and reconciliation of source/external side effects.
2. DUR01 does not primarily fail to preserve Worker reasoning — reasoning is intentionally disposable. What remains unproven is safe recovery from **mid-Worker mutations**, including whether partially applied side effects may be replayed, reconciled, or fenced.

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

## Module decision

```text
durable checkpoint mechanism = implemented and understood
DUR01                         = PASS after hardened REVIEW assertion
first safe resume boundary    = spec_required → implementation_ready
normal default                = still in-memory unless durable is opted in
mid-Worker recovery           = intentionally deferred
Module 17                     = not started
```

Module 16 is closed. Return to Master/Roadmap before choosing the next module.
