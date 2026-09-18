# 19 — Orchestration as Distributed Systems

Практический журнал Module 19.

**Status:** implemented and measured. OWN01 **passed**. Topic Chat owns formal closure.

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
2. `harness/src/workflow-lock.ts` — short per-workflow `mkdir` mutex (not the lease).
3. `harness/src/workflow-lease-store.ts` — acquire / renew / release.
4. `harness/src/workflow-store.ts` — `saveWorkflowStateOwned` under the same mutex.
5. `harness/src/run.ts` — durable invocations generate `ownerId`, acquire, fenced persist, release.
6. `harness/src/ownership-probe.ts` + `run-ownership-invocation.ts` — OWN01 across real OS processes.

Deviation: `workflow-id.ts` holds shared `sanitizeWorkflowId` so store/lock/lease do not import each other in a cycle.

## Lease vs mutex

```text
mutex  = milliseconds; serializes read → decide → persist
lease  = ownership liveness + fencing epoch
```

`mkdir` is the atomic lock primitive. The mutex has a 5s stale recovery on system time so a crashed critical section cannot wedge the control plane. That recovery is **not** takeover of the workflow lease.

## Semantics

| Operation | Token | Owner |
| --- | --- | --- |
| acquire free/released | last+1 | new |
| acquire while held | reject `lease_held` | unchanged |
| takeover expired | last+1 | new |
| acquire(same owner) while valid | reject, not silent renew | unchanged |
| renew current unexpired | unchanged | unchanged, `expiresAt` extended |
| renew expired / stale | reject | unchanged |
| release current owner | unchanged | `null`, `expiresAt=null` |
| stale release | reject | newer owner remains |

## Clock

Production: `Date.now()`. OWN01: `clock.json` `{ now }`. Probe advances the clock; it does not rewrite lease files to fake expiry.

Default durable TTL is 30 minutes because this module has `renew()` but no background heartbeat. Probe TTL is 1000 virtual ms.

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

| Process | pid | token | result |
| --- | ---: | ---: | --- |
| A | 98031 | 1 | later stale ops rejected |
| B-busy | 98033 | — | blocked |
| B | 98053 | 2 | committed `commit-from-B` |

Evidence: `traces/OWN01-ownership-2026-09-18T07-34-27-366Z.txt`

Harness unit tests: **235 passed**, including a two-process acquire race (exactly one winner).

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

## Limitation

Fencing protects WorkflowState/lease writes that check the token.

It does **not** prove a stale worker cannot already have done `fs.writeFile`, worktree mutation, `git push`, network/API, or DB writes.

## Closure decision

Pending Topic Chat. Do not mark complete from this implementation alone.
