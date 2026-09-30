# ORCH01 — Production Orchestration Decision

## Decision

**Current learning harness:** keep the existing lightweight custom orchestration.

**Future real production system with long-running distributed workflows:** prefer a mature durable workflow engine rather than evolving the current JSON/state/lease mechanisms into a bespoke distributed scheduler.

No production orchestration code is justified for the current workload.

## Why the current harness is not a distributed orchestrator

The harness already has useful pieces:

- authoritative semantic `WorkflowState` checkpoints;
- fresh-dispatch resume;
- operation-specific bounded retry;
- single-machine lease + fencing for authoritative WorkflowState writes;
- exact workspace provenance;
- separate GitHub/CI `DeliveryState` reconciliation.

But it does not provide the full production control plane:

- distributed scheduling;
- Task Queues;
- Worker fleet dispatch/redelivery;
- cross-machine ownership;
- durable timers/events;
- Activity heartbeat/liveness;
- backpressure/rate limiting;
- live Worker-version compatibility;
- fleet observability;
- tenant fairness.

The existing lease is intentionally not a scheduler and cannot prevent stale processes from mutating resources that do not enforce its fencing token.

## Boundary if a mature engine is adopted

Engine owns:

```text
durable execution
history/state
Task Queues
worker dispatch/redelivery
timers/events
heartbeat/liveness
infrastructure retry timing
worker-loss recovery
version routing
fleet visibility
```

Harness owns:

```text
Spec semantics
model/context/tools
workspace semantics
VERIFY
REVIEW
repair classification
idempotency/reconciliation policy
GitHub safety
human escalation
software correctness
```

## Workspace decision

A workflow engine does not make the local worktree durable.

Current preferred recovery policy for Implementation:

```text
crash before authoritative checkpoint
→ discard partial workspace
→ reconstruct from last accepted Git/artifact provenance
→ retry only under explicit operation policy
```

Persistent shared workspace or incremental published checkpoints should be introduced only when measured workload/recovery cost justifies their complexity.

## Retry decision

Retry safety is operation-specific.

- VERIFY/REVIEW are usually replayable when they have no dangerous external effects.
- Implementation is not blindly retryable against a partially mutated workspace.
- Git push / PR creation require stable identity and reconciliation after ambiguous outcomes.
- Engine retry delivery does not replace external idempotency or reconciliation.

## Implementation Activity

For a first production mapping, Implementation may remain one long-running Activity with heartbeat and explicit crash recovery policy.

Do not split it into many Activities merely to match orchestration infrastructure. Split only when a semantic checkpoint or independently recoverable unit exists.

## Build-vs-engine reasoning

Continuing toward a custom distributed orchestrator would eventually require building and operating:

```text
transactional durable storage
queue
scheduler
worker heartbeats
cross-machine ownership/fencing
timers
retry service
external event ingestion
versioning
backpressure
fleet observability
fairness
```

At that point the project is building workflow infrastructure in addition to an agent harness.

A mature workflow engine is therefore the preferred future control-plane dependency once the workload actually needs these properties.

## Migration triggers

Reconsider a mature workflow engine when several of these are true:

1. Workflows regularly outlive processes or deployments.
2. Multiple machines/Worker processes execute one workflow fleet.
3. Concurrent workflow volume becomes operationally meaningful.
4. Durable timers or external events are common.
5. Worker loss needs automatic redispatch.
6. Old and new Worker versions must coexist with live workflows.
7. Queueing/backpressure/provider rate limiting is required.
8. Manual lease/lock recovery becomes operational burden.
9. Fleet-level workflow/queue observability is needed.
10. Distributed workspace recovery becomes a real requirement.
11. Multi-tenant fairness/priority becomes relevant.

Before those triggers, the current simpler harness is preferable.

## ORCH01 result

```text
current workload:
no distributed-engine implementation justified

future long-running multi-worker production deployment:
prefer a mature durable workflow engine
over extending local JSON/state/lease mechanisms
into bespoke distributed infrastructure
```
