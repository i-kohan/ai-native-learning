# 19 — Orchestration as Distributed Systems

## Mental model

Once a workflow outlives one OS process, the hard question is not “can we resume?” It is **who may write the next authoritative state**.

```text
workflowId     = identity of the durable work
ownerId        = identity of the current executor/invocation
lease          = temporary ownership
fencingToken   = monotonically increasing ownership epoch
mutex          = short serialization of metadata, not ownership
heartbeat      = liveness, not business progress
```

Expiry of a lease does **not** stop the old process. The old process may wake later. Therefore every authoritative WorkflowState write must present the **current unexpired lease and current fencing token**.

## Mechanism

```text
lock
→ read lease
→ decide (acquire / reject / renew / release / fenced save)
→ persist
→ unlock
```

Acquire/takeover under that lock:

- free or released → token `last+1`
- unexpired holder → `lease_held` (including the same `ownerId`; acquire is not renew)
- expired → takeover with `last+1`

Renew extends `expiresAt` only when owner, token, and unexpired all match. Release clears owner/expiry and **keeps** the token.

Fenced save uses the same mutex so lease validation and the state file replace cannot be split by a takeover.

## What this module proves

```text
A owns token N
B cannot acquire while N is valid
after expiry B owns token > N
stale A cannot commit, renew, or release
current B can commit
final WorkflowState contains only B's result
the model never chooses ownerId / TTL / token
```

OWN01 uses separate processes and a virtual file clock. It does not sleep for real lease TTLs and does not rewrite lease files to fake expiry.

## Boundaries

This is **not**:

- a scheduler or queue;
- Redis / Postgres / Temporal / consensus;
- cross-machine leader election;
- automatic heartbeat;
- workspace/tool fencing;
- exactly-once execution.

`saveWorkflowStateUnfenced` is fixture/bootstrap-only. Durable `run.ts` transitions go through `saveWorkflowStateOwned`. Low-level atomic JSON replace is private.

## Practical observations

1. The mutex and the lease answer different races. Without the mutex, `read then write` loses across processes. Without the token, an expired owner can still write after takeover.
2. Same `ownerId` after expiry must start a new epoch. Silent renew would hide a fencing gap.
3. Distinguishing A’s and B’s commits (`commit-from-A` vs `commit-from-B`) is what makes final-state evidence meaningful.
4. Production durable runs use a 30-minute TTL because this module implements `renew()` but not a background heartbeat.
5. Time-based mutex steal is unsafe: a paused holder is not dead. Prefer a wedged lock after crash over two processes in one critical section.

## Failures / trade-offs

Fencing only protects resources that check the token. A stale Worker may already have mutated the workspace or called the network. Rejecting the later WorkflowState write does not undo those side effects.

A long TTL without heartbeat delays takeover of a dead owner. A short TTL without renew causes live owners to lose fencing mid-run.

## Takeaways

1. Ownership is a control-plane fact, not a model decision.
2. Lease expiry is not process death; fencing tokens exist because stale writers wake up.
3. Short mutex serializes metadata; the lease is the ownership epoch.
4. Authoritative state writes must validate owner + token + unexpired under the same lock as the write.
5. Fencing WorkflowState is not fencing the world.
