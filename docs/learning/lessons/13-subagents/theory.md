# 13 — Subagents (draft)

## Core question

Worker already can `list_files` / `read_file`.

So the question is not “can another agent read the repo?”

It is:

> When does a **separate bounded research episode**, invoked as a Worker tool, repay extra model calls, duplicated context, handoff risk, and latency?

This module is a mechanism probe. Default architecture stays:

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

## 2. Result is evidence, not authority

```text
Spec        = WHAT must be true
Worker      = HOW to implement it
EvidenceReport = what the child observed
Harness     = whether the next phase may run
```

The report cannot expand Spec, grant tools, modify files, run tests, or declare success.

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

## 4. Adoption is an end-to-end question

A correct EvidenceReport proves the mechanism.

It does not prove the pattern should be the default. Count the child in totals. If quality is unchanged and cost rises, reject for this workload.

P01 is small. “Mechanism understood / ROI inconclusive” is an allowed outcome.

## 5. P01 observation

On this controlled probe the Worker never called `delegate_research` (0/3). Quality stayed 3/3. That is evidence that the workload did not need a child, not a prompt failure.

Do not force delegation to manufacture an ROI comparison.

## Takeaways (pre-review)

- Subagent ≠ extra authority.
- Nested research ≠ Planner.
- Typed handoff beats conversation replay.
- Evidence provenance is harness-observed: a child may only cite paths it actually read.
- Optional capability that is never used is still evidence.
- Mechanism correctness ≠ adoption.
