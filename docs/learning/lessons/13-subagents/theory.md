# 13 — Subagents

## Core question

Worker already can `list_files` / `read_file`.

So the question is not “can another agent read the repo?”

It is:

> When does a **separate bounded research episode**, invoked as a Worker tool, repay extra model calls, duplicated context, handoff risk, and latency?

The default architecture remains:

```text
Spec → Worker → VERIFY → REVIEW
```

## 1. Agent-as-tool ≠ outer Planner phase

Module 12 Planner is an optional **outer** episode before Worker.

A research subagent here is nested:

```text
Worker tool call
→ harness-owned boundary
→ fresh read-only child episode
→ validated EvidenceReport
→ Worker continues
```

The child is not a new lifecycle phase and cannot skip VERIFY/REVIEW.

The defining distinction is not merely “a separate model call”. The parent Worker decides that a bounded question is worth delegating; the harness authorizes and constrains the delegation.

## 2. Result is evidence, not authority

```text
Spec           = WHAT must be true
Worker         = HOW to implement it
EvidenceReport = what the child observed
Harness        = whether the next phase may run
```

The report cannot expand Spec, grant tools, modify files, run tests, or declare success.

The Worker remains responsible for deciding whether and how to use the evidence.

## 3. Restriction must be physical

Prompt-only “you are read-only” is not the boundary.

The child is advertised only:

```text
list_files
read_file
submit_evidence_report
```

`write_file`, `run_command`, and `delegate_research` are denied by the executor even if named.

Budget is also harness-owned: one parent call, small child turn limit, no descendants.

Evidence provenance is harness-observed:

```text
finding.evidencePaths ⊆ actual child read_file paths
inspectedPaths = DiscoveryTracker reads
```

A child may only cite paths it actually read. The harness does not try to prove that a semantic claim is true.

## 4. Context isolation and decomposition quality

The main benefit of a research subagent is **context isolation**: it can inspect a broader area and return a compact structured result without filling the parent Worker context with all intermediate exploration.

This only helps when the delegated question is reasonably separable.

Good candidate:

```text
Worker needs to implement feature X
→ delegate bounded compatibility / impact research
→ child returns compact evidence
→ Worker continues implementation
```

Poor candidate:

```text
Step B continuously depends on the exact reasoning and discoveries from Step A
→ Worker must repeatedly adapt implementation as it learns
```

That tightly coupled reasoning is usually better kept inside one Worker. Delegation adds handoff loss and coordination overhead without creating a clean boundary.

Likewise, deterministic lookup such as “find every usage of symbol X” is often better implemented as a normal search/tool rather than another model episode.

## 5. Adoption is an end-to-end question

A correct EvidenceReport proves the mechanism.

It does not prove the pattern should be the default. Count the child in totals. If quality is unchanged and cost rises, reject for this workload.

P01 is small. “Mechanism understood / ROI inconclusive” is an allowed outcome.

## 6. P01 observation

On the controlled probe the Worker never called `delegate_research` (0/3). Quality stayed 3/3. That is evidence that the workload did not need a child, not a prompt failure.

Do not force delegation to manufacture an ROI comparison.

## Final takeaways

- Subagent ≠ semantic role and ≠ extra authority.
- Nested research ≠ outer Planner phase.
- Harness decides capabilities, budget, and lifecycle; Worker decides whether a bounded question is worth delegating.
- Typed handoff beats conversation replay when the result can be compactly transferred.
- Evidence provenance is harness-observed: a child may only cite paths it actually read.
- Provenance admission does not prove the child interpreted those files correctly.
- Use a Subagent when the research is sufficiently large and separable that context isolation repays coordination cost.
- Keep reasoning inside one Worker when the task is small or the reasoning is tightly coupled and continuously dependent across steps.
- Optional capability that is never used is still evidence.
- Mechanism correctness ≠ adoption.
