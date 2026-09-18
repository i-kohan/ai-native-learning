# 19 — Orchestration as Distributed Systems

## Mental model

Once a workflow outlives one OS process, the hard question is not only “can we resume?” but **who may make the next authoritative change**.

```text
workflowId     = identity of the durable work
ownerId        = identity of the current executor/invocation
lease          = temporary ownership
fencingToken   = monotonically increasing ownership epoch
mutex          = short serialization of metadata, not ownership
heartbeat      = ownership liveness, not business progress
```

These answer different questions:

- `workflowId`: which durable work is this?
- checkpoint: where may execution continue?
- retry policy: may this logical operation be attempted again?
- ownership: which executor may authoritatively act now?

A lease expiry does **not** stop the old process. The old process may still be running, paused in a model call, or wake later. That is why lease expiry alone is insufficient: stale consequences must be fenced.

A `fencingToken` is **not a secret or authentication credential**. It is a monotonically increasing epoch number that an enforcing resource uses to reject work from an older ownership epoch.

## Lease lifecycle

Acquire/takeover is serialized by the short per-workflow mutex:

```text
lock
→ read current lease
→ decide acquire / reject / takeover
→ persist lease
→ unlock
```

Semantics:

- free or released lease → new owner gets `lastToken + 1`;
- unexpired holder → reject `lease_held`, including the same `ownerId`;
- expired holder → takeover with `lastToken + 1`;
- same `ownerId` after expiry still starts a **new ownership epoch**.

Renew is different from acquire:

```text
A acquire → token 41
A renew   → token 41
A renew   → token 41
expiry
A acquire → token 42
```

Renew extends `expiresAt` only while owner, token, and the unexpired lease still match. It does not increment the fencing token.

Release clears `ownerId` and `expiresAt` but preserves the last fencing token, so the next ownership epoch is strictly newer. A stale release after takeover cannot clear the new owner's lease.

## Heartbeat / renewal

A heartbeat is conceptually a periodic harness-owned `renew()`:

```text
acquire lease
→ work
→ renew
→ work
→ renew
→ ...
```

Heartbeat means:

> “this ownership epoch is still live enough to keep its lease.”

It does **not** mean:

- Worker made semantic progress;
- VERIFY passed;
- a checkpoint advanced;
- the task is healthy or correct.

Likewise, a missing heartbeat can let a lease expire, but it does **not** prove that the old process died. The old process may wake after takeover and must still be fenced.

This module implements correct `renew()` semantics but intentionally does **not** run an automatic heartbeat loop.

## Short mutex vs workflow lease

The short mutex and the workflow lease solve different races.

The mutex exists for milliseconds around metadata transitions:

```text
lock
→ read
→ decide
→ persist
→ unlock
```

The lease survives outside that critical section and grants temporary workflow ownership.

Without the mutex, two processes can both read the same old lease and both decide they acquired it. Without the lease/fencing token, an old process can resume after takeover and still look authoritative.

The final learning implementation uses local-file `O_CREAT | O_EXCL` acquisition plus a holder token. It intentionally has **no time-based stale-lock stealing**. A paused process is not assumed dead merely because time passed.

If a process dies while holding this short mutex, the lock file may remain and future callers time out. This is an explicit **fail-closed safety-over-availability trade-off** for the single-machine learning harness.

## Fenced authoritative write

Every authoritative durable WorkflowState transition uses the same per-workflow mutex as ownership transfer:

```text
lock
→ read CURRENT lease
→ validate workflowId + ownerId + fencingToken + unexpired
→ atomically replace WorkflowState
→ unlock
```

Validation and state write must be in the same critical section.

This is unsafe:

```text
A validates token 41
unlock

B takes over with token 42

A writes state
```

The current `saveWorkflowStateOwned()` closes that check-then-write race.

## Fencing token vs stateVersion / CAS

These solve related but different stale-write problems.

```text
fencingToken
→ protects against a stale OWNER from an older ownership epoch

stateVersion / CAS
→ protects against a stale STATE SNAPSHOT even within the same ownership epoch
```

Example: if one current owner somehow had two concurrent continuations based on state version 7, CAS could allow the first `7 → 8` write and reject the second stale write still expecting version 7.

Module 19 intentionally does **not** add `stateVersion` / CAS. The current durable runner is sequential within one invocation, and OWN01 is specifically about stale ownership across processes. Adding CAS would introduce a second concurrency mechanism without being required to prove the ownership invariant.

## What this module proves

OWN01 proves the following control-plane behavior on one machine:

```text
A owns token N
B cannot acquire while N is valid
after expiry B owns token > N
stale A cannot commit, renew, or release
current B can commit
final WorkflowState contains only B's result
the model never chooses ownerId / TTL / token
```

OWN01 uses separate OS processes and a virtual file clock. It advances time through the clock abstraction; it does not rewrite lease files to fake expiry.

The separate mutex regression tests additionally show that elapsed time alone cannot bypass a live/paused short-mutex holder.

## Failure matrix

| Situation | Current behavior |
| --- | --- |
| A dies during normal workflow work | lease eventually expires; a later invocation may take over |
| A is paused, lease expires, B takes over | A may wake, but later authoritative WorkflowState writes are fenced |
| healthy A runs longer than its TTL without renewal | A loses authority; a later commit is rejected even if its result is otherwise good |
| A dies while holding the short mutex | mutex file may remain; later callers time out until manual recovery |
| stale A tries renew/release after B takeover | rejected; B remains owner |
| stale A already mutated worktree / git / API / DB | WorkflowState fencing does not undo or prevent that side effect |
| wall clock jumps forward/backward | lease expiry can occur earlier/later than expected; this harness does not solve distributed-clock semantics |

## Current TTL trade-off

Current non-probe durable runs default to a **30-minute lease TTL** because no automatic heartbeat loop exists.

That value is a pragmatic harness setting, **not a production recommendation**.

For example:

```text
00:00 A acquires
00:05 A starts a long model/tool operation
00:30 lease expires
00:40 operation returns
00:40 A tries authoritative save → rejected
```

This is safe for WorkflowState authority but can waste computation. A production-quality runtime would normally pair an appropriate TTL with heartbeat/renewal and explicit ownership-loss handling.

## Boundaries

This is **not**:

- a scheduler or queue;
- Redis / Postgres / Temporal / consensus;
- cross-machine leader election;
- automatic heartbeat;
- stateVersion/CAS;
- workspace/tool fencing;
- external side-effect reconciliation;
- exactly-once execution.

The short mutex is a **single-machine local-filesystem learning mechanism**. Its correctness claim is not a distributed-lock claim and should not be generalized to arbitrary network filesystems.

`saveWorkflowStateUnfenced` is fixture/bootstrap-only. Durable `run.ts` transitions go through `saveWorkflowStateOwned`. Low-level atomic JSON replacement is private.

Fencing protects only resources that actually enforce the token. A stale Worker may already have mutated files, pushed git, or called an external API before its later WorkflowState save is rejected.

## Takeaways

1. Ownership is a control-plane fact, not a model decision.
2. Workflow identity, checkpoint, retry admission, and current ownership are orthogonal questions.
3. Lease expiry is not process death; stale writers are why fencing tokens exist.
4. Heartbeat extends ownership liveness; it is not business progress.
5. A short mutex serializes ownership metadata; the lease represents the longer-lived ownership epoch.
6. Authoritative state writes must validate owner + token + expiry under the same serialization boundary as the write.
7. Fencing and CAS protect different kinds of staleness.
8. Fencing WorkflowState is not fencing the world.
9. When safe automatic lock recovery is unavailable, fail-closed can be the correct learning trade-off.
