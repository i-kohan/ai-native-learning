# Module 28 — Closure

**Status:** MASTER CLOSED on 2026-10-01.

## Understanding check

PASS.

The learner can now distinguish:

- Workflow vs Worker vs orchestration Task vs Activity;
- Workflow Task vs Activity Task;
- Task Queue as a routing/buffering boundary;
- current semantic-snapshot durability vs event-history/replay;
- deterministic Workflow logic vs nondeterministic Activities;
- Activity retry vs external idempotency vs reconciliation;
- heartbeat/liveness vs semantic checkpoint;
- cancellation request vs rollback of side effects;
- queue waiting vs started-but-hung timeouts;
- backpressure/fairness as control-plane concerns;
- Worker/workflow code versioning vs payload/schema versioning;
- durable workflow state vs coding-agent workspace durability;
- agent topology vs physical orchestration topology;
- reliable execution vs software correctness.

## Practical conclusion

The current harness should **not** add a distributed scheduler, Task Queue, Worker fleet, Temporal cluster, Kubernetes deployment, durable timer service, or generic cross-machine ownership mechanism for this module.

The optional `ActivityContract` classification exercise was also skipped: the side-effect/retry matrix and ORCH01 already capture the intended learning, so additional code would encode known conclusions without creating meaningful new evidence.

## Current architecture decision

Keep:

- lightweight custom orchestration;
- semantic `WorkflowState` checkpoints;
- bounded operation-specific retry;
- single-machine lease/fencing;
- current workspace provenance;
- explicit GitHub/CI reconciliation.

If a future production system crosses the ORCH01 migration triggers, prefer a mature durable workflow engine for the execution control plane while retaining the harness as the authority for Spec, agent policy, workspace semantics, VERIFY, REVIEW, repair, external reconciliation, human escalation, and software-correctness decisions.

See:

- `theory.md`
- `notes.md`
- `orch01-decision.md`

No harness code changed in Module 28.


## Master acceptance

Master review accepted ORCH01 and the decision not to implement production orchestration infrastructure for the current workload.

The module correctly separates:

```text
workflow engine / control plane
= reliable distributed execution mechanics

agent harness / domain layer
= Spec, model/context/tool policy, workspace semantics,
  VERIFY, REVIEW, repair policy, reconciliation, human escalation,
  and software-correctness consequences
```

The following production gaps are correctly identified as absent from the current harness:

- distributed scheduling / Task Queues / Worker fleet;
- automatic worker-loss redispatch;
- durable timers and external-event waits;
- Activity heartbeat/liveness semantics;
- backpressure / rate limiting / fairness;
- live Worker-version coexistence;
- fleet-level observability;
- distributed workspace recovery.

The retry/idempotency/reconciliation distinction is accepted. A workflow engine may reliably redeliver work without making arbitrary external effects exactly-once.

Precision retained:

- a read-only/stochastic LLM episode such as REVIEW is generally replayable with respect to external side effects, but another attempt is not semantically guaranteed to return the same judgment; retry remains harness-budgeted/admitted;
- the proposed mid-Implementation policy (discard/reconstruct from last authoritative checkpoint) is a future production design direction, not a claim that the current harness automatically performs this recovery.

Current decision:

```text
current learning workload
→ keep lightweight custom orchestration

future long-running / multi-worker production workload
crossing ORCH01 migration triggers
→ prefer a mature durable workflow engine
over growing local JSON/store/lease mechanisms
into a bespoke distributed scheduler
```

No Module 28 implementation is required. Remaining closure blockers: none.
