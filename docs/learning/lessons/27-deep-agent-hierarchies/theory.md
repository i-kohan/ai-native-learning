# 27 — Deep Agent Hierarchies

## Core question

A shallow Lead can already coordinate several sibling workers.

The question is:

> When does adding another coordinator level solve a measured fan-in / context / coordination bottleneck strongly enough to pay for extra latency, handoff loss, token cost, debugging complexity, and authority risk?

This module treats deep hierarchy as an **advanced / conditional topology**, not as a default upgrade from bounded multi-agent execution.

## Depth vs breadth

Breadth:

```text
Root
├─ W1
├─ W2
├─ ...
└─ W30
```

Depth:

```text
Root
├─ Manager A
│  ├─ W1
│  └─ ...
├─ Manager B
│  └─ ...
└─ Manager C
   └─ ...
```

Worker count alone does not justify depth.

The useful trigger is a **measured coordinator bottleneck**: the current coordinator starts losing coverage, missing child findings, mishandling failures/conflicts, saturating synthesis context, or spending too much work on coordination as fan-in grows.

## Span of control

For agents, span of control means how much child state/results one coordinator can reliably receive, track, reconcile, and synthesize within acceptable quality, context, latency, and cost.

If 30 workers each return about 8 KB, a shallow Root may receive about 240 KB of reports. A hierarchy can be useful only if natural subtrees exist and local managers materially reduce Root load, for example:

```text
30 × 8 KB leaf reports
→ 3 domain managers
→ ~15 KB domain artifact each
→ Root receives ~45 KB
```

The compression is useful only if the manager also preserves uncertainty, failures, and provenance.

## What a manager can add

A useful manager can provide:

- local routing/decomposition inside one domain;
- local conflict reconciliation;
- local failure bookkeeping;
- bounded replacement proposals;
- semantic compression;
- a smaller, structured artifact for the parent.

A manager that merely converts 80 KB of child reports into 70 KB of prose without provenance or local coordination is mostly an expensive relay.

## Telephone-game risk and provenance

Every additional model boundary can omit or distort information.

Therefore hierarchy may compress upward, but source evidence should remain reachable:

```text
Root
→ Manager summary
→ sourceArtifact references
→ leaf artifacts
→ original evidence
```

A parent should not need raw child conversations, but it should be able to dereference the structured leaf artifact behind an important claim.

## Failure propagation

A fluent manager summary must not erase an incomplete subtree.

If a required worker fails:

```text
W1 → SUCCESS
W2 → FAILED
W3 → SUCCESS
```

then the subtree remains PARTIAL until new admitted evidence covers the missing area.

The harness should derive workflow consequence from structured facts, not trust a manager's prose label.

Compression may happen upward; uncertainty and incompleteness must not silently disappear upward.

## Authority: no amplification

Hierarchy must not create authority from model output.

Conceptually:

```text
childCapabilities ⊆ parentSubtreeCapabilities ⊆ globalPolicy
```

A read-only manager cannot create a write-enabled child merely because it believes writes would help.

The model may propose children. The harness admits or rejects them.

## Budgets

Deep delegation can multiply cost explosively unless resources remain inside a global envelope.

For consumable resources:

```text
manager own consumption
+ descendant consumption
≤ subtree budget

total workflow consumption
≤ global workflow budget
```

The same idea applies to tokens, model calls, tool calls, wall time, node count, fan-out, and depth.

A robust hierarchy therefore needs harness-owned limits such as:

- max depth;
- max fan-out per node;
- max total nodes;
- global/subtree token and call budgets;
- capability boundaries.

## Routing, delegation, agent-as-tool, handoff

These concepts are related but distinct.

```text
routing:
"Where should this work go?"

delegation:
"Do this bounded subtask and return the result to me."

agent-as-tool:
a concrete delegation pattern where a manager invokes a specialist and keeps ownership

handoff:
ownership/active conversation moves to another specialist
```

A hierarchy is not automatically a chain of handoffs. The Module 27 topology is primarily repeated bounded delegation where parents remain coordinators.

## Adoption rule

Do not add a hierarchy level because the task is "complex" or because worker count is large.

Use this causal chain:

```text
fan-in grows
→ measured coordinator degradation
→ work naturally partitions into subtrees
→ local managers plausibly reduce that bottleneck
→ bounded hierarchy experiment
→ evaluate benefit versus added cost
```

If the coordinator still handles the workload reliably, hierarchy is unnecessary.

## Current conclusion

The current SWM01 topology has only three child reports and about 24.6 KB of synthesis input. There is no observed coordinator saturation.

The first multi-agent layer itself also did not show stable ROI over the single-investigator baseline.

Therefore Module 27 establishes the decision rule and authority/provenance invariants, but does not implement a deep hierarchy.
