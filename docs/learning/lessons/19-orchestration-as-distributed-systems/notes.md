# 19 — Orchestration as Distributed Systems

Практический журнал Module 19.

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-18. OWN01 **passed**.

## Что построили

Minimal single-machine ownership for durable WorkflowState:

```text
acquire lease (ownerId + fencingToken)
→ execute durable phase work
→ fenced save under the same short mutex as lease checks
→ release if this invocation still owns that epoch
```

Expiry does not kill process A. A can wake later. Authoritative writes still fail if the token is stale.

## Learning-critical files

1. `harness/src/workflow-lease.ts` — lease types, parse, file clock.
2. `harness/src/workflow-lock.ts` — short per-workflow exclusive file lock (not the lease).
3. `harness/src/workflow-lease-store.ts` — acquire / renew / release.
4. `harness/src/workflow-store.ts` — `saveWorkflowStateOwned` under the same mutex.
5. `harness/src/run.ts` — durable invocations generate `ownerId`, acquire, fenced persist, release.
6. `harness/src/ownership-probe.ts` + `run-ownership-invocation.ts` — OWN01 across real OS processes.

Deviation: `workflow-id.ts` holds shared `sanitizeWorkflowId` so store/lock/lease do not import each other in a cycle.

## Key correction discovered during review

The first mutex draft used a 5-second stale timeout and deleted an old `.mutex` directory. That was rejected because it recreated the same distributed-systems mistake the module is about:

```text
time elapsed
≠
old process is dead
```

A paused process could still be inside the critical section while another process deleted its mutex and entered. The final design therefore removed time-based stealing entirely and chose fail-closed `O_EXCL` acquisition.

This correction is part of the learning outcome, not just implementation cleanup.

## Lease vs mutex

```text
mutex  = milliseconds; serializes read → decide → persist
lease  = ownership liveness + fencing epoch
```

The short mutex is `O_CREAT | O_EXCL` plus a unique holder token, with a bounded wait timeout and **no** stale-time deletion.

Acquire:

```text
prepare holder token
→ atomic exclusive create
→ write that token through the same fd
→ close fd
→ mutex acquired
```

If the token write fails after this process created the file, the fd is closed and the just-created file is unlinked when we still know we created it. Otherwise fail closed. No mtime/PID steal.

Release:

```text
read current token
if current != handle token → do nothing
otherwise unlink the lock file
```

That unlink is safe **under this protocol** because a replacement holder cannot be created while the lock file exists. It is not a general atomic compare-and-delete. Manual/external removal of the mutex file while a process still owns it is outside the supported protocol.

A paused holder keeps the file, so elapsed time cannot let another process in. If a process dies while holding the short mutex, the mutex file may remain and future callers time out. This learning implementation intentionally fails closed rather than guessing that a holder is dead. That is not workflow-lease takeover.

## Semantics

| Operation                       | Token                    | Owner                           |
| ------------------------------- | ------------------------ | ------------------------------- |
| acquire free/released           | last+1                   | new                             |
| acquire while held              | reject `lease_held`      | unchanged                       |
| takeover expired                | last+1                   | new                             |
| acquire(same owner) while valid | reject, not silent renew | unchanged                       |
| renew current unexpired         | unchanged                | unchanged, `expiresAt` extended |
| renew expired / stale           | reject                   | unchanged                       |
| release current owner           | unchanged                | `null`, `expiresAt=null`        |
| stale release                   | reject                   | newer owner remains             |

## Clock

Non-probe runtime: `Date.now()`. OWN01: `clock.json` `{ now }`. Probe advances the clock; it does not rewrite lease files to fake expiry.

Current non-probe durable TTL defaults to 30 minutes because this module has `renew()` but no automatic heartbeat. This is a pragmatic harness setting, not a production recommendation. Probe TTL is 1000 virtual ms.

## OWN01 recorded run (2026-09-18)

Command: `npm run benchmark:own01`

Choreography (equivalent to the spec sequence; B-busy and B-owner are distinct processes):

```text
A acquires token 1 and waits
B-busy acquire while valid → blocked
clock 1000 → 3000
B-owner acquires token 2
A stale commit/renew/release → rejected
B remains owner
B commits commit-from-B
final WorkflowState = B
```

| Process |   pid | token | result                    |
| ------- | ----: | ----: | ------------------------- |
| A       | 47401 |     1 | later stale ops rejected  |
| B-busy  | 47403 |     — | blocked                   |
| B       | 47405 |     2 | committed `commit-from-B` |

Evidence: `traces/OWN01-ownership-2026-09-18T17-31-54-674Z.txt`

Harness unit tests: **239 passed**, including:

- paused holder > old 5s stale threshold is not bypassed (challenger times out);
- normal release then later acquire succeeds;
- previous holder cannot unlink a newer mutex;
- two-process acquire race has exactly one winner.

## Regression

- DUR01 PASS
- CHK01 PASS
- RET01 PASS

Modules 16–18 semantics were not weakened. Durable `run.ts` now refuses unfenced authoritative saves.

## Commands

```bash
cd harness && npm test
cd harness && npm run benchmark:own01
cd harness && npm run benchmark:dur01
cd harness && npm run benchmark:chk01
cd harness && npm run benchmark:ret01
```

## Operational failure matrix

| Situation | Current behavior |
| --- | --- |
| owner dies during normal workflow work | lease may expire and a later invocation may take over |
| owner wakes after takeover | authoritative WorkflowState commit/renew/release is rejected |
| live operation exceeds TTL without renewal | result may be wasted because the later authoritative save is rejected |
| process dies inside short mutex | mutex file may remain; callers fail closed / time out |
| stale worker already changed workspace or external system | not prevented or rolled back by WorkflowState fencing |

## Limitation

Fencing protects WorkflowState/lease writes that check the token.

It does **not** prove a stale worker cannot already have done `fs.writeFile`, worktree mutation, `git push`, network/API, or DB writes.

Mutex crash behavior: if a process dies while holding the short mutex, the mutex file may remain and future callers time out. This learning implementation intentionally fails closed rather than guessing that a holder is dead. A live/paused holder cannot be bypassed because time elapsed.

## Closure decision

**Topic Chat closure: PASS — 2026-09-18.**

Closure basis:

- understanding check passed;
- lease/ownership implementation reviewed;
- unsafe time-based mutex stealing found during review and removed;
- mutex regression tests cover paused-holder and stale-release cases;
- OWN01 PASS with real separate processes;
- DUR01 / CHK01 / RET01 regression PASS;
- documented boundaries do not overclaim workspace/external-side-effect safety.

No further implementation is required for Module 19. Remaining production-grade ownership, heartbeat, side-effect fencing, distributed coordination, and recovery belong to later modules.
