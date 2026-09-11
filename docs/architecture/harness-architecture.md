# Harness Architecture

Last consolidated: 2026-09-11, after Module 16 durable checkpoint probe (module not formally closed).

This document is a compact map of the **current architecture**, not a target-state design. Historical experiment details remain in `docs/learning/lessons/` and `docs/learning/experiments.md`.

## 1. Current normal path

The normal learning architecture is intentionally conservative:

```text
raw task
→ targeted context
→ read-only Spec / ambiguity gate
→ one implementation Worker
→ deterministic VERIFY
→ bounded verification repair if needed
→ independent REVIEW
→ bounded review repair if needed
→ final measured outcome
```

For isolated benchmark/eval execution, an outer runner additionally owns:

```text
exact committed base SHA
→ detached Git worktree
→ workspace-bound config
→ workflow
→ eval / independent grader where applicable
→ cleanup
```

The main principle remains:

> The model owns an attempt. The outer harness owns authority, evidence, and workflow consequence.

## 2. Authority boundaries

### Spec

Owns **what must be true** and whether unresolved ambiguity requires human judgment.

Spec is product/behavior authority. It is not an implementation plan.

### Worker / inner episode

Owns **how to execute the currently allowed objective**:

- repository inspection;
- local implementation reasoning;
- bounded tool sequencing;
- implementation changes.

A terminal model response is only an episode outcome. It is not workflow success.

### Verifier

Owns deterministic executable evidence available to the workflow.

Current primary verification is repository test execution through the harness-owned verification boundary.

### Reviewer

Owns independent judgment over the produced artifact, grounded in:

- Spec;
- actual diff;
- architecture constraints;
- deterministic verification evidence.

Reviewer does not receive Planner rationale or Worker chain-of-thought.

### Outer harness / orchestrator

Owns:

- whether implementation may start;
- workspace/config authority;
- model-routing policy;
- retry budgets;
- VERIFY / REVIEW transitions;
- human escalation;
- workflow success/failure;
- trace/eval truth.

When durability is opted in, the outer harness also owns:

- WorkflowState schema and phase;
- admission of `spec_required → implementation_ready`;
- atomic local-file persistence;
- resume binding to the persisted workspace.

The model still cannot mutate WorkflowState. Trace JSONL is not authoritative workflow state.

Security-sensitive decisions belong here when the harness can technically enforce them.

## 3. Main implementation surfaces

| Responsibility | Main code |
| --- | --- |
| Outer workflow | `harness/src/run.ts` |
| Inner agent/tool loop | `harness/src/loop.ts` |
| Spec phase | `harness/src/spec-phase.ts`, `harness/src/spec.ts` |
| Targeted context | `harness/src/context.ts` |
| Tools / capability boundary | `harness/src/tools.ts`, `harness/src/paths.ts` |
| Verification | `harness/src/verify.ts`, `harness/src/failure.ts`, `harness/src/repair.ts` |
| Independent review | `harness/src/review-phase.ts`, `harness/src/review.ts` |
| Skills | `harness/src/skills.ts`, `skills/evidence-guided-repair/` |
| Model routing | `harness/src/model-routing.ts`, `harness/src/config.ts` |
| Workspace isolation | `harness/src/workspace.ts` |
| Durable workflow state | `harness/src/workflow-state.ts`, `harness/src/workflow-store.ts` |
| Tracing | `harness/src/trace.ts` |
| Evals / qualification | `harness/src/eval/` |
| Benchmark/probe runner | `harness/src/run-benchmark.ts` |

## 4. Normal architecture vs experimental seams

The presence of a mechanism in source code does **not** mean it belongs to the default path.

### Normal / retained core

- targeted context in the normal CLI;
- Spec + ambiguity gate;
- one Worker with implicit local planning;
- deterministic VERIFY + bounded repair;
- independent REVIEW + bounded review repair;
- one reusable evidence-guided repair Skill where relevant;
- harness-owned routing boundary, currently all normal semantic episodes on the default model;
- tracing and eval normalization;
- worktree isolation for benchmark/eval runs;
- DEV / HOLDOUT / probe separation and independent holdout graders.

### Opt-in: first durable checkpoint

**Status:** implemented as a mechanism probe; default `runV1Harness()` remains in-memory.

Supported:

- harness-owned `spec_required → implementation_ready` admission;
- file-backed WorkflowState with atomic replace;
- resume in a fresh process without rerunning Spec;
- fail-closed load and workspace mismatch.

Not started:

- mid-Worker crash/idempotency;
- Temporal / queues / leases;
- Module 17 generalized checkpoint/resume.

### Experimental: `previous_response_id`

**Status:** keep as a selectable experiment seam; default remains `manual` conversation-state replay.

Supported:

- provider-side continuation mechanism works;
- outer authority remains unchanged;
- client history replay is reduced.

Not established:

- token or wall-time improvement.

**Revisit when:** provider/runtime economics or long episodes make client replay a meaningful bottleneck.

### Experimental: explicit Planner

**Status:** keep OFF by default.

P01 showed equal quality with worse end-to-end cost.

**Revisit when:** Durable/production workloads become planning-sensitive enough that up-front decomposition may reduce meaningful backtracking, failed work, or coordination cost.

### Experimental: bounded research Subagent

**Status:** keep OFF by default.

The bounded agent-as-tool boundary is understood and tested, but P01 Workers naturally delegated 0/3 times, so ROI is unproven.

**Revisit when:** a real task has an independently verifiable research/impact-analysis subproblem whose context would otherwise materially pollute or block the lead Worker.

### Experimental: human-reviewable decomposition

**Status:** keep conditional, not default.

A merely advisory ReviewPlan failed to create real review surfaces. Harness-owned `UnitExecutionScope` did create real sequential boundaries, but at roughly 2× orchestration cost on P02.

**Revisit when:** GitHub/CI delivery can turn semantic units into actual review/merge surfaces and human review cost can be measured.

### Retained routing boundary

The current policy routes all normal episodes to the same model, but the deterministic routing boundary is cheap and useful for future requalification. Keep it.

## 5. Eval architecture after Module 15

Evidence categories remain separate:

```text
DEV / regression
HOLDOUT
mechanism probes
isolation probes
security probes
```

Qualification adds:

```text
freeze task/grader
+ resolve one exact baseRevision
+ pin one configured model identity
+ repeat stochastic holdout trials
+ run independent benchmark-owned grader
+ require full workflow outcome AND grader outcome
+ reject mixed/missing provenance
+ apply predefined decision rule
```

Important semantics:

- `VERIFY PASS` is workflow evidence, not independent ground truth;
- `escapedDefect` is meaningful only when an independent grader exists;
- `3/3` is an observed count, not 100% reliability;
- once a holdout result is used to tune the harness, that workload becomes DEV/known for future qualification.

## 6. Security / isolation boundary

Current worktree isolation prevents benchmark tasks from sharing one mutable checkout.

Current verification-child environment uses a positive allowlist so repository tests do not inherit harness secrets such as `OPENAI_API_KEY`.

This is **not** a general sandbox. Repository code executed under the current OS account can still have filesystem/network/subprocess authority beyond the logical source-write boundary.

Worktree isolation and security containment are separate concerns.

## 7. Phase-3 consolidation decisions

### Keep

- the normal Spec → Worker → VERIFY/repair → REVIEW/repair flow;
- routing boundary;
- targeted-context implementation;
- eval/qualification layer;
- optional experiment seams listed above, because each has a concrete future re-evaluation trigger.

### Do not add

- generic Planner framework;
- generic subagent framework;
- swarm/manager hierarchy;
- parallel task scheduler;
- stacked-PR platform;
- a generic Temporal-style workflow engine (Module 16 is one local checkpoint, not that).

### Do not refactor yet

`run.ts` is now a gravity center, but extracting pieces only for file-size aesthetics would add churn without improving the model.

Durable Execution introduced the first bounded slice of that architecture: WorkflowState, harness-owned admission, a file persistence adapter, and resume/reconciliation for `implementation_ready`. `run.ts` now has a post-Spec executor reused by both the uninterrupted path and durable resume. It is still not a generic workflow engine.

## 8. Known cleanup / production debts entering Phase 4

These are intentional follow-ups, not reasons to reopen completed modules.

1. **`runV1Harness()` low-level default still uses `contextMode="baseline"`.** The normal CLI explicitly selects targeted context (`variant`). When the next code-changing refactor touches workflow configuration, make targeted context the normal API default and keep baseline only as an explicit ablation mode.
2. **Workspace isolation is not globally mandatory at the `runV1Harness()` API boundary.** Benchmark/eval runners create exact-base worktrees; the simple manual CLI calls the harness directly. Durable/production entrypoints should own mandatory workspace creation instead of relying on callers to opt in.
3. **`run.ts` contains optional Planner/Subagent/decomposition wiring.** Keep it through Phase 4 only while those seams remain cheap and potentially reusable; if Durable/GitHub workloads still do not justify them, remove or move experiment-only plumbing out of the core path.
4. **Benchmark breadth is still small.** H01/H02 improve methodology, not broad software-engineering coverage. Future failures/production-like tasks should expand capability coverage organically.
5. **Provider snapshot provenance is limited to configured model identity.** Backend changes hidden behind a stable provider alias are not fully detectable.
6. **Current security boundary is not hostile-code containment.** A real production deployment would require stronger process/container/network isolation.

## 9. Remaining Phase 4 question

Module 16 proved one checkpoint:

```text
spec_required → implementation_ready → (fresh process) Worker/VERIFY/REVIEW → terminal
```

Still open:

> What happens if the process dies mid-Worker, mid-VERIFY, or while ownership is contested?

That is later durable/distributed work, not a reason to reopen this first checkpoint.
