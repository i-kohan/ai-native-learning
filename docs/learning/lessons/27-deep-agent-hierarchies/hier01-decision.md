# HIER01 — Deep hierarchy architecture decision

Date: 2026-09-29

Decision: **NO IMPLEMENTATION JUSTIFIED FOR CURRENT WORKLOAD**

## Observed problem

None.

The current SWM01 Lead receives three child reports totaling 24,619 bytes for synthesis. The recorded evidence does not show Lead context saturation, fan-in confusion, unreliable failure bookkeeping, or a hierarchy-specific quality bottleneck.

## Candidate mechanism

If a future workload produces many naturally separable domains, the candidate topology is:

```text
Root
├─ Manager A
│  └─ bounded leaf workers
├─ Manager B
│  └─ bounded leaf workers
└─ Manager C
   └─ bounded leaf workers
```

Managers would locally route/decompose, reconcile conflicts/failures, and emit compact domain artifacts with references to leaf artifacts.

## Expected benefit

Reduce Root span of control and synthesis fan-in while preserving the ability to inspect original evidence.

## Required authority model

The harness remains the authority boundary.

Managers may propose decomposition and resource allocation, but may not mint capabilities, budget, recursion, or lifecycle authority.

Required relation:

```text
childCapabilities ⊆ parentSubtreeCapabilities ⊆ globalPolicy
```

## Required resource model

A global workflow envelope must bound all descendants.

```text
node own consumption + descendants ≤ subtree allocation
total workflow consumption ≤ global workflow budget
```

At minimum, a future mechanism would need bounds for depth, fan-out, total nodes, tokens/calls, and wall time.

## Required artifact/provenance model

A manager aggregate must preserve references to the leaf artifacts/evidence supporting important claims.

Manager summaries are compression, not replacement truth.

Root must be able to dereference leaf evidence when required.

## Partial failures

A child failure or uncovered required area must remain visible upward.

A manager cannot turn PARTIAL into complete coverage through prose. Missing coverage may be cleared only when new admitted evidence actually covers the same area.

## New failure modes introduced by hierarchy

- extra critical-path model stage;
- telephone-game / semantic compression loss;
- pure relay managers with little useful compression;
- hidden child failures;
- budget multiplication;
- authority amplification;
- recursive spawning explosion;
- manager context saturation;
- harder tracing/debugging;
- correlated errors or false consensus;
- one slow subtree delaying parent synthesis.

## Evidence required before adoption

Reopen HIER01 only when current coordinator degradation is measurable and causally linked to fan-in/coordination load, for example:

- quality/coverage decreases as child count/report volume grows;
- Root repeatedly drops leaf findings;
- Root mishandles partial failures or conflicts;
- synthesis context/resource budget becomes a practical limit;
- natural independent subtrees exist;
- a manager layer can demonstrate meaningful compression/local coordination while preserving provenance;
- repeated evals show the benefit exceeds added cost, latency, and complexity.

## Current conclusion

Module 27 does not justify implementing a deep hierarchy.

This is the intended advanced/conditional outcome:

```text
mechanism understood
+ adoption conditions defined
+ current workload has no hierarchy need
→ no implementation
```
