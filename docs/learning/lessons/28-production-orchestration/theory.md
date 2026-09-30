# Module 28 — Production-Grade Distributed Orchestration

## Core mental model

The current harness has durable semantic checkpoints, resume, bounded retries, single-machine lease/fencing, and GitHub delivery reconciliation. That is useful durable execution, but it is not a distributed workflow control plane.

A production orchestrator separates:

```text
Workflow
= long-lived logical execution

Workflow Task
= short deterministic "what happens next?" evaluation

Activity
= nondeterministic / external work

Activity Task
= one concrete delivery/attempt of an Activity

Worker
= process that polls a Task Queue and executes supported Tasks

Task Queue
= durable routing/buffering boundary between workflows and Workers
```

One Workflow normally produces many Workflow Tasks and Activity Tasks over its lifetime.

## Replay and determinism

A Temporal-like engine persists execution history and can replay deterministic Workflow code to reconstruct logical state. Completed Activity results are taken from recorded history rather than repeating the external side effect during replay.

This differs from the current harness:

```text
current harness:
authoritative current semantic snapshot

Temporal-like model:
event history + deterministic replay
→ reconstructed workflow state
```

Workflow code therefore should decide orchestration only. LLM calls, filesystem mutation, subprocesses, Git, GitHub, network APIs, and other nondeterministic operations belong in Activities.

## Reliable execution != software correctness

The workflow engine can reliably schedule and redeliver work. It does not know whether a software change is correct.

```text
Implementation Activity completed
→ artifact exists

VERIFY
→ evidence

REVIEW
→ independent judgment

harness/domain policy
→ repair / human / stop / success
```

VERIFY, REVIEW, repair classification, workspace policy, tool authority, and human escalation remain harness-owned.

## Retry, idempotency, reconciliation

These are separate concepts.

```text
retry
= execute another attempt

idempotency
= repeating the same logical operation does not create an additional logical effect

reconciliation
= inspect reality after an ambiguous result and determine what actually happened
```

A workflow engine can redeliver an Activity attempt, but it cannot make an arbitrary GitHub/API/filesystem side effect exactly-once.

For ambiguous external operations:

```text
stable logical identity
+ idempotency where available
+ reconciliation when outcome is uncertain
```

are domain responsibilities.

## Heartbeat vs semantic checkpoint

```text
heartbeat
= liveness / operational progress

semantic checkpoint
= authoritative recovery boundary
```

"edited 15/20 files" may be useful progress, but it does not prove that the implementation is valid or safe to resume from.

Durable semantic facts are stronger than durable model cognition.

## Durable waits and cancellation

Long-lived workflows may wait for:

- a timer;
- CI completion;
- human approval;
- another external event.

The Worker process does not need to stay alive while the Workflow waits.

Cancellation is cooperative:

```text
cancel requested
!=
external side effects rolled back
```

Cleanup, compensation, and external-state policy remain domain-specific.

## Backpressure and fairness

At scale, "there is runnable work" is not enough reason to start it immediately.

Production orchestration may need:

- Worker concurrency limits;
- queue buffering;
- provider/API rate limits;
- cost/resource limits;
- priority;
- tenant quotas/fair scheduling.

This is control-plane logic, not prompt logic.

## Versioning

Workflow lifetime may exceed deployment lifetime.

Changing deterministic Workflow code can make new commands disagree with old recorded history. Production systems therefore need explicit Worker/Workflow version compatibility.

This is distinct from durable payload/schema versioning. Old Workflow/Activity results may also need compatibility handling.

## Coding-agent workspace problem

Durable orchestration does not make a local Git worktree durable.

Possible production strategies:

1. Recreate a workspace from durable Git/artifact provenance.
2. Use a persistent remote workspace/volume with stronger ownership/fencing.
3. Publish durable semantic checkpoints and reconstruct from the latest accepted one.

For the current harness, the simplest safe default after a mid-Implementation crash is:

```text
discard partial workspace
→ restore last authoritative checkpoint
→ retry under explicit policy
```

Mid-VERIFY retry is usually safer when verification has no dangerous external side effects.

## Main architectural boundary

```text
workflow engine:
reliable distributed execution

agent harness:
domain meaning, authority, and correctness
```
