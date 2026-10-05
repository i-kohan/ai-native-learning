# Harness Architecture

Last consolidated: 2026-10-05, after completion of Modules 01–29 (Module 21 intentionally skipped as not applicable).

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
- admission of `spec_required → implementation_ready → review_ready`;
- atomic local-file persistence;
- resume binding to the persisted workspace;
- durable pre-Worker review baseline artifact, referenced from `review_ready`;
- retry classification, retry budget, and retry admission;
- workflow lease ownership, fencing token, and fenced authoritative WorkflowState writes.

The model still cannot mutate WorkflowState or decide whether another attempt is allowed. Trace JSONL is not authoritative workflow state.

Security-sensitive decisions belong here when the harness can technically enforce them.

## 3. Main implementation surfaces

| Responsibility              | Main code                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Outer workflow              | `harness/src/run.ts`                                                                                                            |
| Inner agent/tool loop       | `harness/src/loop.ts`                                                                                                           |
| Spec phase                  | `harness/src/spec-phase.ts`, `harness/src/spec.ts`                                                                              |
| Targeted context            | `harness/src/context.ts`                                                                                                        |
| Tools / capability boundary | `harness/src/tools.ts`, `harness/src/paths.ts`                                                                                  |
| Verification                | `harness/src/verify.ts`, `harness/src/failure.ts`, `harness/src/repair.ts`                                                      |
| Independent review          | `harness/src/review-phase.ts`, `harness/src/review.ts`                                                                          |
| Skills                      | `harness/src/skills.ts`, `skills/evidence-guided-repair/`                                                                       |
| Model routing               | `harness/src/model-routing.ts`, `harness/src/config.ts`                                                                         |
| Workspace isolation         | `harness/src/workspace.ts`                                                                                                      |
| Durable workflow state      | `harness/src/workflow-state.ts`, `harness/src/workflow-store.ts`                                                                |
| Workflow ownership/fencing  | `harness/src/workflow-lease.ts`, `harness/src/workflow-lock.ts`, `harness/src/workflow-lease-store.ts`                          |
| GitHub / CI delivery        | `harness/src/delivery-state.ts`, `harness/src/delivery-store.ts`, `harness/src/delivery-run.ts`, `harness/src/github-client.ts` |
| Retry policy                | `harness/src/retry.ts`                                                                                                          |
| Tracing                     | `harness/src/trace.ts`                                                                                                          |
| Verified repository memory  | `harness/src/memory.ts`, `harness/src/memory-store.ts`                                                                          |
| Evals / qualification       | `harness/src/eval/`                                                                                                             |
| Benchmark/probe runner      | `harness/src/run-benchmark.ts`                                                                                                  |
| MCP integration             | `harness/src/mcp/`, `harness/src/mcp01-probe.ts`                                                                                |
| A2A integration             | `harness/src/a2a/`, `harness/src/a2a01-probe.ts`                                                                                |
| Bounded multi-agent probe   | `harness/src/investigation-swarm.ts`, `harness/src/swarm-plan.ts`, `harness/src/swm01-probe.ts`                                |
| Self-improvement probe      | `harness/src/meta01/`, `harness/src/meta01-probe.ts`                                                                            |

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

### Opt-in: durable checkpoints

**Status:** implemented as mechanism probes; default `runV1Harness()` remains in-memory.

Supported:

- harness-owned `spec_required → implementation_ready → review_ready` admission;
- file-backed WorkflowState with atomic replace;
- resume in a fresh process without rerunning Spec, or without rerunning Worker + pre-review VERIFY;
- durable pre-Worker `FileSnapshot` baseline stored beside WorkflowState;
- fail-closed load, workspace mismatch, and baseline integrity mismatch;
- harness-owned retry classification/budget/admission for independent REVIEW;
- single-machine workflow lease, fencing token, and fenced WorkflowState saves.

Not started:

- mid-Worker / mid-VERIFY crash reconciliation;
- exactly-once semantics;
- Temporal / queues / cross-machine leader election;
- workspace/tool fencing or stale side-effect reconciliation.

Bounded REVIEW retry is implemented as a mechanism probe. It does not make mutating Worker execution retry-safe. REVIEW retry state stays on `review_ready` until the next durable semantic boundary (terminal, or a new logical `operationId`); a successful in-memory REVIEW result does not clear the budget by itself. Unknown `model_error` is not automatically transient.

### Opt-in: post-terminal GitHub delivery

**Status:** implemented as a Module 20 mechanism; default `runV1Harness()` is unchanged and still rejects terminal resume.

Supported:

- separate `DeliveryState` linked by `workflowId`;
- deterministic `agent/<workflowId>` branch, draft PR, no force push, no merge;
- exact-head CI admission;
- at most one semantic CI repair with fresh local VERIFY + REVIEW.

`WorkflowState` fencing does not fence GitHub. Intended `expectedHeadSha` is not a cached remote head.

A workflow lease is not a scheduler. Expiry does not stop the old process. Authoritative WorkflowState writes reject a stale fencing token. The short mutex is an `O_EXCL` lock file with a holder token (not a time-based stale steal) and is not the lease.

The current non-probe durable TTL defaults to 30 minutes only because there is no automatic heartbeat loop; this is a pragmatic harness setting, not a production recommendation. A live operation that outlasts the TTL can lose authority and have its later state commit rejected.

The short mutex intentionally fails closed: if a process dies inside the critical section, the lock file may remain and later callers time out until manual recovery. This is a single-machine/local-filesystem learning mechanism, not a distributed-lock claim.

No `stateVersion`/CAS is implemented. Fencing protects against stale ownership epochs; CAS would address stale state snapshots within an ownership epoch and is deferred because the current durable runner is sequential within one invocation.

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

### Experimental: bounded parallel fan-out

**Status:** keep OFF by default.

The seam exists: one Spec, frozen two-unit `FanOutPlan`, exact-base worktrees, `sequential | parallel`, Git 3-way fan-in. Authoritative PAR01 on P03 (one frozen SHA + one frozen executable Spec across 3×2 scheduling trials) was `not_worth_current_workload` (conflicts in a shared service file; wall can improve, cost higher). Earlier per-trial Spec/HEAD runs are not evidence.

**Revisit when:** units are semantically independent **and** their source deltas have low integration coupling / can be composed deterministically with a low conflict rate, while e2e wall time is the scarce resource. Separate files help but are not required.

### Experimental: verified repository memory

**Status:** mechanism probe only. Default `runV1Harness()` does not read or write memory.

One repository-scoped implementation-surface fact can be admitted after VERIFY PASS and an independent REVIEW pass, stored outside `WorkflowState`, and revalidated against the current repository before a single advisory Worker hint. The harness derives repository scope from the bound `config.repoRoot`; the caller does not supply it. Durable execution rejects `memory.promote` and `memory.retrieve` as `unsupported_mode`.

Not adopted:

- vector / embedding retrieval;
- automatic extraction from traces or conversations;
- memory that changes workflow phase, Spec, or VERIFY/REVIEW authority.

**Revisit when:** repeated cross-run facts are common and expensive enough to rediscover that a bounded, current-state-validated hint has measurable end-to-end value.

### Experimental: A2A impact delegation

**Status:** mechanism probe only. Default `runV1Harness()` does not delegate.

`a2aDelegationEnabled` exposes one Worker tool, `delegate_remote_analysis({ objective, scope })`. The Host spawns `harness-impact-agent`, discovers its v1 Agent Card over HTTP, and admits it before `SendMessage`. The binding is HTTP+JSON. A validated `ImpactAnalysis` artifact is advisory Worker evidence. An invalid delegated scope is rejected before `SendMessage` and does not widen the remote filesystem to the allowed root. The remote process does not receive the parent environment or `OPENAI_API_KEY`, and it cannot write, verify, or review. Durable execution rejects this mode. SDK `@a2a-js/sdk@1.2.1`, protocol `1.0`.

**Revisit when:** a task has an impact-analysis episode that should run in a separate agent runtime, and A2A01 has been measured on that workload. This seam does not replace MCP or the Module 13 subagent.

### Experimental: bounded multi-agent investigation (SWM01)

**Status:** mechanism PASS, not adopted. It is not wired into `runV1Harness()`.

One Lead may propose a 2–3 worker `SwarmPlan`. The harness admits the plan, runs fresh read-only workers concurrently, and asks the Lead to synthesize an `InvestigationReport`. The Lead does not choose models, tools, turn limits, or write access. This is not the default coding path and it is not a swarm platform.

**Revisit when:** a breadth-first investigation workload shows that the extra tokens and handoff loss are worth the coverage or wall-time change. Until then the default remains one Worker.

### Experimental: META01 self-improvement control plane

**Status:** separate probe only. It is not wired into `runV1Harness()`.

`npm run benchmark:meta01` runs one bounded Meta-Improver against frozen parent `afc1abdc0f8f528a3d45b2c1495fea35e74c6aa7`. The candidate may overwrite `harness/src/loop.ts` and create at most two new files under `harness/src/loop-ext/`. The host materializes a detached `candidateRevision`, scores it, and leaves adoption to a human. A candidate verdict does not move `main` or become the runtime default.

**Revisit when:** a later module needs another bounded harness-mutation experiment. This seam is not a self-improvement framework.

### Decision only: deep agent hierarchy

**Status:** understood and not implemented.

HIER01 found no measured coordinator bottleneck in the current shallow multi-agent topology: three child reports and about 24.6 KB of synthesis input did not justify another coordinator layer.

**Revisit when:** fan-in/context/coordination load causes measurable coordinator degradation and work naturally partitions into independent subtrees. Any future hierarchy must preserve no-authority-amplification, subtree/global budgets, explicit failure propagation, and dereferenceable leaf-artifact provenance.

### Decision only: production distributed orchestration

**Status:** architecture decision only; no workflow engine adopted.

ORCH01 concluded that the current learning harness should stay lightweight. A real long-running multi-worker production system should prefer a mature durable workflow engine over extending local JSON/state/lease mechanisms into a bespoke distributed scheduler.

**Migration triggers:** workflows span deployments, multiple worker processes/machines, durable timers/events, automatic redispatch, queue/backpressure, live worker-version coexistence, fleet observability, or distributed workspace recovery.

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

## 7. Post-roadmap architecture decisions

### Keep

- the normal Spec → Worker → VERIFY/repair → REVIEW/repair flow;
- routing boundary;
- targeted-context implementation;
- eval/qualification layer;
- optional experiment seams listed above, because each has a concrete future re-evaluation trigger.

### Do not add

- generic Planner framework;
- generic subagent framework;
- swarm/manager hierarchy as the default path (SWM01 is one bounded probe, not that platform);
- parallel task scheduler;
- stacked-PR platform;
- a generic Temporal-style workflow engine (Module 16 is one local checkpoint, not that).

### Refactor only with a concrete target architecture

`run.ts` and `loop.ts` remain gravity centers and now also contain several experiment-only seams. At roadmap completion, the next justified refactor is not cosmetic file splitting: it is separating a smaller production-shaped normal path from experiment adapters/runners **if** this repository is going to become a real portfolio/production harness.

If the repository remains primarily a learning reference, keeping the experiment seams co-located may be more valuable than aggressively deleting them.

See `docs/learning/final-capstone-review.md`.

## 8. Known cleanup / production debts after roadmap completion

These are intentional follow-ups, not reasons to reopen completed modules.

1. **`runV1Harness()` low-level default still uses `contextMode="baseline"`.** The normal CLI explicitly selects targeted context (`variant`). When the next code-changing refactor touches workflow configuration, make targeted context the normal API default and keep baseline only as an explicit ablation mode.
2. **Workspace isolation is not globally mandatory at the `runV1Harness()` API boundary.** Benchmark/eval runners create exact-base worktrees; the simple manual CLI calls the harness directly. Durable/production entrypoints should own mandatory workspace creation instead of relying on callers to opt in.
3. **`run.ts` contains optional Planner/Subagent/decomposition wiring.** Keep it through Phase 4 only while those seams remain cheap and potentially reusable; if Durable/GitHub workloads still do not justify them, remove or move experiment-only plumbing out of the core path.
4. **Benchmark breadth is still small.** H01/H02 improve methodology, not broad software-engineering coverage. Future failures/production-like tasks should expand capability coverage organically.
5. **Provider snapshot provenance is limited to configured model identity.** Backend changes hidden behind a stable provider alias are not fully detectable.
6. **Current security boundary is not hostile-code containment.** A real production deployment would require stronger process/container/network isolation.

## 9. Production boundary after Module 28

Modules 16–20 established local durability, retry, ownership/fencing, and GitHub/CI reconciliation. Module 28 made the remaining boundary explicit:

```text
current harness
= lightweight local durable orchestration

future multi-worker / long-running production system
= candidate for a mature durable workflow engine
```

Still intentionally unresolved until a real workload requires them:

- mid-Worker crash reconciliation;
- durable/shared workspace strategy;
- fencing or reconciliation for external side effects;
- automatic heartbeat/liveness;
- distributed Task Queues / worker fleet;
- backpressure / fairness;
- live worker-version coexistence;
- fleet-level observability.

A workflow engine would own reliable execution mechanics. The harness would still own Spec semantics, model/context/tool policy, workspace meaning, VERIFY, REVIEW, repair/admission policy, external reconciliation, human escalation, and software correctness.

## 10. Final roadmap status

Modules 01–29 are covered. Module 21 Browser QA was intentionally skipped because the current capstone has no meaningful UI workload.

The final decision matrix, capability assessment, cleanup priorities, and recommended next phase live in:

`docs/learning/final-capstone-review.md`
