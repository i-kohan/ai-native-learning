# 16 — Durable Execution

## Главная идея

Durable execution (устойчивое выполнение) — это способность **всего engineering workflow** пережить смерть внешнего процесса.

Это не то же самое, что:

```text
previous_response_id  = continuation внутри одного episode
background job        = один provider request переживает HTTP
compaction / session  = conversation memory
trace JSONL           = evidence, не authority
```

Authoritative state — это harness-owned **WorkflowState**.

## Mental model

```text
OUTER HARNESS
owns: workflowId, phase, workspace, admitted Spec, transitions

INNER EPISODE
owns: how to execute the currently allowed objective
```

Модель предлагает Spec. Harness admits переход. Модель не пишет WorkflowState.

## Execution flow

```text
initialize spec_required
→ Spec phase
→ harness admits executable Spec
→ persist implementation_ready   ← checkpoint completed only after rename
→ [process A may end]
→ fresh process B loads the same workflowId
→ validate existing workspace/base/fingerprint
→ skip Spec
→ Worker → VERIFY/repair → REVIEW/repair
→ persist terminal
```

Crash **before** persist → предыдущая фаза остаётся authoritative; Spec может понадобиться снова.

Crash **after** persist → fresh process обязан продолжить с новой фазы и **не** rerun Spec.

## Boundaries

- Один checkpoint: `spec_required → implementation_ready`. Не checkpoint после каждого tool call.
- Workflow, не Node process, владеет resumable workspace.
- Missing/corrupt/unsupported state → fail closed, не silent new workflow.
- Missing/mismatched workspace → fail closed, не replacement worktree.
- Experimental Planner/Subagent/ReviewPlan на durable path явно запрещены.
- Default `runV1Harness()` остаётся in-memory, пока не передан `durable`.

## Observations from DUR01

1. Process A (pid 91015) persisting `implementation_ready` and dying is enough for process B (pid 91509) to continue the same T02 workflow.
2. Process B had `specModelCalls=0` and `spec_phase_skipped`; Spec ran once across the resumed workflow.
3. VERIFY PASS and independent REVIEW pass stayed the existing outer authority; durability did not move them inward.
4. Control (uninterrupted durable T02) also succeeded, so the `run.ts` split did not regress the normal post-Spec pipeline.

## Takeaways

1. Workflow state ≠ conversation state ≠ trace log.
2. Checkpoint completed = next WorkflowState successfully persisted.
3. Resume must bind the intended workspace, not recreate one.
4. Uncommitted fixture/setup state is not in `baseRevision`; fingerprint that tree if the probe needs it.
5. First durable slice can be one real phase boundary. Do not start a generic workflow engine to learn the concept.
6. Mid-Worker crash recovery is a different, later problem.
