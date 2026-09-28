# 27 — Deep Agent Hierarchies notes

Status: **CLOSED by Topic Chat on 2026-09-29**. HIER01 = `no_implementation_justified`.

## Current workload

The strongest current multi-agent evidence is SWM01 from Module 26:

```text
Lead
├─ mechanism-runtime
├─ activation-contracts
└─ durability-evidence
```

Final recorded pair:

- all three children succeeded and overlapped;
- child report sizes: 8,007 B, 6,453 B, 8,288 B;
- synthesis input: 24,619 B;
- baseline: 290,930 input tokens, 88,096 ms, coverage 8/9, correctness 1.0;
- variant: 533,716 input tokens, 90,206 ms, coverage 7/9, correctness 0.7143.

The current Lead therefore has a span of control of only three children and no measured synthesis overload.

## Candidate hierarchy

A future hierarchy would make sense only for a workload closer to:

```text
Root
├─ Domain Manager A → many independent leaves
├─ Domain Manager B → many independent leaves
└─ Domain Manager C → many independent leaves
```

where Root fan-in itself becomes the observed problem.

## HIER01 trigger evidence

Before implementing a second coordinator level, require evidence such as:

- coverage or correctness degrading as fan-in grows;
- child findings present in leaf artifacts but repeatedly omitted by Root synthesis;
- failure / partial-coverage bookkeeping becoming unreliable;
- conflict reconciliation degrading;
- synthesis context approaching its practical budget;
- coordination overhead dominating useful reasoning;
- stable, natural domain partitions that can be coordinated locally.

Worker count by itself is not evidence.

## Required invariants if hierarchy is ever implemented

Authority:

```text
childCapabilities ⊆ parentSubtreeCapabilities
```

Budget:

```text
node own consumption + descendants ≤ subtree budget
all subtree consumption ≤ global workflow budget
```

Failure:

```text
leaf failure
→ remains visible upward
→ cannot become SUCCESS from prose alone
→ can be cleared only by new admitted evidence covering the gap
```

Provenance:

```text
leaf artifact/evidence
→ referenced by manager aggregate
→ remains dereferenceable by Root
```

## Orchestration vocabulary

- Routing: choose destination.
- Delegation: child does a bounded subtask and returns.
- Agent-as-tool: a specialist is invoked as a tool; manager keeps ownership.
- Handoff: ownership moves to the specialist.
- Hierarchy: coordinator tree; not inherently a handoff chain.

## Topic Chat result

Understanding check: **PASS**.

The learner correctly identified:

- breadth versus depth;
- hierarchy as a response to coordinator overload, not agent count;
- the value of manager-side compression while retaining provenance;
- harness-owned authority and global/subtree budgets;
- monotonic propagation of missing coverage/failures;
- the routing / delegation / agent-as-tool / handoff distinction.

No code, benchmark, or toy CEO → manager → worker mechanism was justified.
