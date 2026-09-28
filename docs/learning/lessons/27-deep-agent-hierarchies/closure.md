# 27 — Closure

Status: **CLOSED by Topic Chat on 2026-09-29**.

HIER01: **NO IMPLEMENTATION JUSTIFIED FOR CURRENT WORKLOAD**.

## What was learned

Deep hierarchy is not "more agents" and not an automatic next step after a shallow swarm.

Its useful purpose is to relieve a **measured coordinator bottleneck** by introducing local coordination/compression over natural subtrees.

The decision trigger is therefore not task complexity or worker count. It is observed degradation in the current coordinator as fan-in grows.

## Core distinctions

Breadth:

```text
Root → many sibling workers
```

Depth:

```text
Root → managers → workers
```

A manager is useful when it materially reduces parent coordination load through local routing, conflict/failure handling, and semantic compression.

A manager that merely relays prose adds cost without solving a bottleneck.

## Authority and resources

The model may propose topology; the harness admits it.

Hierarchy must not amplify authority:

```text
childCapabilities ⊆ parentSubtreeCapabilities ⊆ globalPolicy
```

Consumable resources remain inside subtree/global envelopes:

```text
node + descendants ≤ subtree budget
all consumption ≤ global workflow budget
```

A future implementation would require harness-owned bounds on depth, fan-out, node count, calls/tokens, and wall time.

## Failure and provenance

Compression may occur upward, but failures, uncertainty, and missing coverage must remain visible.

A manager summary cannot erase a failed child or invent complete coverage.

Important claims should retain references to leaf artifacts/evidence so the Root can inspect the source instead of relying on repeated summaries.

## Handoff boundary

Routing, delegation, agent-as-tool, and handoff were separated:

- routing chooses where work should go;
- delegation asks a child to complete a bounded subtask and return;
- agent-as-tool is a delegation pattern where the manager retains ownership;
- handoff transfers ownership/active conversation to the specialist.

Deep hierarchy is primarily a coordinator/delegation topology, not inherently a handoff chain.

## HIER01 evidence

Current SWM01 final pair has three child reports totaling 24,619 bytes of synthesis input.

No evidence shows the Lead failing because of fan-in, context pressure, routing burden, or failure bookkeeping.

The first multi-agent layer also has no stable demonstrated ROI over the single-investigator baseline.

Adding another coordinator level now would therefore add latency, handoff loss, token cost, tracing complexity, and new authority/budget failure modes without an observed problem to solve.

## Final Understanding Check

Result: **PASS**.

The learner correctly understood:

1. hierarchy should respond to measurable coordinator overload rather than agent count;
2. manager compression is useful only when it reduces coordination load while preserving provenance;
3. child authority cannot exceed the admitted parent subtree authority;
4. global/subtree budgets prevent recursive cost multiplication;
5. child failure/missing coverage cannot disappear through a manager summary;
6. routing, delegation, agent-as-tool, and handoff are distinct orchestration concepts.

## Topic Chat decision

Module 27 is closed from the Topic Chat side.

No toy hierarchy implementation is warranted.

Revisit deep hierarchy only when a real workload shows measurable coordinator degradation and natural subtrees whose local coordination can plausibly remove that bottleneck.

Default remains the current shallow/default execution architecture.
