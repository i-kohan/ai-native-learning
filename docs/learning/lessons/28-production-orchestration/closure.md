# Module 28 — Closure

**Status:** CLOSED from Topic Chat side on 2026-09-30.

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
