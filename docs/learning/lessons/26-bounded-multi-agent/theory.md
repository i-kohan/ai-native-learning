# 26 — Bounded multi-agent investigation

## Core question

One investigator can already read the repository.

The question is:

> When does a shallow Lead plus 2–3 fresh read-only workers improve a breadth-first investigation enough to pay for duplicated context, handoff loss, and extra tokens?

This module probes that topology once. It does not make multi-agent the default coding path.

## Mental model

```text
objective
→ Lead proposes a SwarmPlan (ids, objectives, optional hints)
→ harness admits or rejects the plan
→ 2–3 fresh read-only workers run concurrently
→ each worker returns a ChildInvestigationReport
→ Lead sees those reports and explicit failures, not the conversations
→ Lead writes one InvestigationReport
→ an external grader scores that report
```

The default coding path stays:

```text
Spec → one Worker → VERIFY / repair → independent REVIEW / review repair
```

SWM01 is not inside `runV1Harness()`.

## Authority

The Lead proposes decomposition only.

The harness owns:

```text
minWorkers = 2
maxWorkers = 3
maxRounds = 1
workersReadOnly = true
workersMayDelegate = false
turn budgets
model identity
```

An over-budget plan is rejected. Workers are not started. The harness does not widen the budget to fit the proposal.

Each worker is advertised only:

```text
list_files
read_file
submit_investigation_report
```

`write_file`, `run_command`, `delegate_research`, `delegate_remote_analysis`, and `spawn_worker` are absent from the tool list. The executor also rejects those names.

## What concurrency proves

Workers are started with `Promise.all`. Each child records `startedAt`, `finishedAt`, and `durationMs`.

Overlap is an interval fact: two workers overlapped when each started before the other finished. A shorter sum of durations is not the claim. The claim is that the intervals actually overlapped.

There is no scheduler, no second round, and no automatic respawn.

## Handoff and failure

A child may cite only paths that worker actually read. The harness's observed `read_file` list is the provenance check. That proves the citation was read, not that the sentence is true.

The Lead's synthesis input is the objective, the admitted child reports, and explicit failures. Raw child conversations stay in the child episode and are discarded.

If worker B fails, synthesis still receives B's failure. The harness also writes that failure into the final report's uncertainties and marks coverage incomplete. B is not replaced.

A finding can still disappear during synthesis: the child had a path, and the final report does not. The grader scores the final report, so a child discovery that the Lead drops does not count as coverage.

## What one pair can say

Same final schema and the same external grader make the arms comparable.

They do not justify "multi-agent is better."

Useful readings of one pair:

- broader coverage, much higher token cost
- same grade, duplicated reads
- workers found paths the Lead dropped
- wall time fell while total model cost rose
- worker objectives overlapped, so the split failed

Adoption would need a repeated workload-specific comparison, not this probe.

## Takeaways

- SwarmPlan proposes work. The harness admits resources and tools.
- Fresh worker context is the point of the split. Sharing conversations would undo it.
- Provenance admission is a read-set check, not a truth check.
- A failed child must remain visible. Do not respawn it to hide the hole.
- Grade the final report. The recorded handoff metric is dropped child evidence paths. A path that survives does not prove the claim was preserved.
- Mechanism success and adoption are separate. The default remains one Worker.
