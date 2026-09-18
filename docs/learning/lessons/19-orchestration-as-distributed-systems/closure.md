# Module 19 — Orchestration as Distributed Systems — Master Closure

**Status:** ✅ MASTER CLOSED on 2026-09-18.

## Accepted result

Module 19 establishes bounded single-machine workflow ownership for the durable harness:

- short per-workflow exclusive mutex serializes lease/state metadata transitions;
- lease carries current `ownerId`, expiry, and monotonically increasing `fencingToken`;
- takeover after expiry creates a newer ownership epoch;
- stale owners cannot renew, release, or authoritatively persist WorkflowState;
- current-owner validation and WorkflowState replacement happen under the same mutex;
- ownership is harness/store policy, not model authority.

## OWN01

Recorded OWN01 evidence demonstrates with separate OS processes:

```text
A acquires token N
→ B blocked while A lease valid
→ lease expires
→ B takes over with token N+1
→ stale A commit/renew/release rejected
→ B commit succeeds
→ final WorkflowState contains B result only
```

Primary evidence:

`docs/learning/lessons/19-orchestration-as-distributed-systems/traces/OWN01-ownership-2026-09-18T17-31-54-674Z.txt`

Harness tests at closure: **239 passed**.

DUR01, CHK01, and RET01 were rerun successfully after the final fail-closed mutex correction.

## Important review correction

The first mutex draft treated elapsed time as permission to steal an old lock.

That was rejected because:

```text
lock is old
≠
lock holder is dead
```

The final implementation uses local-file `O_CREAT | O_EXCL` acquisition with a holder token and **no time-based stale-lock stealing**.

A process dying inside this short critical section may leave a wedged mutex and reduce availability. For this learning harness that is an explicit fail-closed safety trade-off.

## Scope boundary

This module does **not** prove:

- workspace/tool/git/network side-effect fencing;
- exactly-once semantics;
- automatic heartbeat;
- stateVersion/CAS;
- cross-machine distributed locking or consensus;
- generic scheduler/queue semantics;
- arbitrary side-effect reconciliation.

Fencing protects only resources that enforce the fencing token.

## Final mental model

```text
workflowId   = which durable work
checkpoint   = where it may resume
retry policy = whether an operation may be attempted again
lease        = who should currently own execution
fencing      = whether that owner may still authoritatively commit
```

No remaining blocker for the intended Module 19 scope.

Next roadmap module: **20 — GitHub / CI Integration**.
