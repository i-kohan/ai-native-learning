# 26 — Bounded multi-agent investigation

## Core question

One investigator can already read the repository.

The question is:

> When does a shallow Lead plus 2–3 fresh read-only workers improve a breadth-first investigation enough to pay for duplicated context, handoff loss, synthesis loss, and extra tokens?

This module studies one bounded multi-agent **workflow topology**. It does not make multi-agent the default coding path.

## The important distinction: topology, not a magic agent primitive

`Promise.all([agentA(), agentB(), agentC()])` is only a concurrency primitive.

The multi-agent system is the surrounding topology:

```text
objective
→ Lead decomposes the problem
→ harness admits resources/capabilities
→ several fresh reasoning contexts execute bounded objectives
→ each returns a structured artifact
→ semantic fan-in / synthesis
→ external evaluation
```

The useful questions are therefore not merely "did three model calls run?" but:

- who decomposes the work;
- who controls worker count, tools, budgets, and lifecycle;
- what each worker can see and do;
- what artifact crosses the handoff boundary;
- how failures remain visible;
- how several reports become one system output;
- how the final result is evaluated.

Multi-agent orchestration can be implemented with ordinary model calls, tool loops, processes, queues, HTTP/A2A, or simple language-level concurrency. The topology and authority boundaries are the architectural part.

## Module 13 → Module 26 is a continuum

There is no hard protocol boundary between the Module 13 Subagent and Module 26.

Module 13 studied the smaller primitive:

```text
Worker
→ occasionally delegates one bounded research question
→ fresh read-only child
→ EvidenceReport
→ Worker continues the main task
```

The child is an auxiliary capability of the Worker.

Module 26 studies the point where several sibling reasoning contexts become a material part of solving the objective:

```text
                 Lead
          ┌───────┼───────┐
          ↓       ↓       ↓
          A       B       C
          └──── reports ───┘
                  ↓
              synthesis
```

If a Module 13 Worker starts dynamically decomposing one objective into several sibling research children, runs them concurrently, collects their reports, and synthesizes them, that Worker is effectively becoming the Module 26 Lead.

So the new learning problem is not a new model technology. It is **system-level coordination**:

- work allocation;
- worker-count/resource budgets;
- overlap and duplication;
- partial child failure;
- semantic fan-in;
- synthesis bottlenecks;
- termination;
- system-wide cost.

## Relation to Module 22 fan-out

Module 22 and Module 26 both use parallel workers, but the fan-in is different.

Module 22:

```text
harness freezes implementation units
→ workers edit isolated worktrees
→ source/Git fan-in
→ integration conflicts are the central risk
```

Module 26 SWM01:

```text
Lead proposes semantic investigation slices
→ read-only workers gather evidence
→ structured knowledge artifacts
→ Lead semantic synthesis
```

The current Module 26 probe intentionally uses read-only breadth-first research because coding introduces shared-state and integration coupling already exposed by Module 22.

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

## Why separate contexts can help — and why that is not guaranteed

A worker with a smaller objective can spend its context budget on one investigation direction instead of carrying the entire repository audit.

Potential benefits:

- lower per-worker context pressure;
- less interference between unrelated investigation directions;
- broader repository coverage;
- specialization around different questions;
- concurrent exploration.

But none of those imply higher final quality.

A worker can still miss evidence or reason incorrectly. Multiple workers can duplicate the same search trajectory. The Lead can drop useful evidence during synthesis. Total system token usage can be much higher than a single-agent run.

The experiment must measure whether the extra contexts pay for themselves on a specific workload.

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

This is the central boundary:

```text
Lead decides:
WHAT split appears useful

Harness decides:
HOW MUCH authority and resources that split receives
```

Model output is not resource authority. The reason is broader than prompt injection: model output is probabilistic and must not independently expand cost, write capability, recursion, or lifecycle authority.

Each worker is advertised only:

```text
list_files
read_file
submit_investigation_report
```

`write_file`, `run_command`, `delegate_research`, `delegate_remote_analysis`, and `spawn_worker` are absent from the tool list. The executor also rejects those names.

## What concurrency proves

Workers are started with `Promise.all`. Each child records `startedAt`, `finishedAt`, and `durationMs`.

Overlap is an interval fact: two workers overlapped when each started before the other finished.

That proves real parallel execution. It does **not** prove lower end-to-end latency.

Overall latency still includes:

```text
Lead planning
+ worker wave
+ handoff
+ synthesis
```

There is no scheduler, no second round, and no automatic respawn.

## Semantic fan-in and the synthesis bottleneck

The Lead's synthesis input is:

```text
original objective
+ admitted child reports
+ explicit child failures
```

Raw child conversations are not passed to synthesis.

A child may cite only paths that worker actually read. The final Lead may cite only evidence paths that successful children actually exported in their reports.

That distinction matters:

```text
child read B.ts
but child did not report B.ts
→ Lead cannot introduce B.ts as synthesis evidence
```

The system output is the final `InvestigationReport`, not the union of everything that ever existed in child contexts.

Therefore a useful child discovery can still be lost during fan-in. The frozen grader scores the final report, which makes synthesis loss observable.

`droppedChildEvidencePaths` is deliberately only an evidence-path metric. A path that survives does not prove that the child's semantic claim survived.

## Failure semantics

A failed child does not silently disappear and is not automatically respawned.

If:

```text
A → success
B → failure
C → success
```

then synthesis receives A, C, and an explicit B failure. The harness marks coverage incomplete.

A partial result may still be useful, but partial coverage must not masquerade as complete coverage.

## Correlated error: agreement is not verification

Several workers can agree and still be wrong.

Correlation can come from:

- the same incorrect repository assumption;
- the same misleading source;
- the same model bias;
- the same ambiguous task wording;
- copied or overlapping investigation paths.

Therefore:

```text
A agrees with B agrees with C
≠
VERIFY PASS
```

Consensus is evidence about agreement, not deterministic truth.

External grading or deterministic verification remains a separate authority.

## What the experiment can say

The same final schema and frozen external grader make baseline and variant comparable.

One run does not justify:

> "multi-agent is better"

or:

> "multi-agent does not work"

The correct separation is:

```text
mechanism question:
did the intended bounded topology actually work?

ROI/adoption question:
did it improve this workload enough to justify its extra cost and complexity?
```

SWM01 showed that the mechanism works, while the observed workload did not show a stable advantage over one Investigator.

## Takeaways

- Multi-agent is primarily an interaction topology over several ordinary agent loops, not a special swarm primitive.
- Module 13 and Module 26 are a continuum; Module 26 starts when multi-child coordination and synthesis become a first-class system problem.
- Fresh worker contexts can improve breadth, but quality improvement is empirical, not assumed.
- SwarmPlan proposes work. The harness admits resources and tools.
- Parallel workers do not automatically reduce end-to-end latency.
- Structured reports are the communication boundary; raw reasoning histories are not the fan-in format.
- Synthesis is a real bottleneck and part of the system outcome.
- Worker consensus is not VERIFY.
- Mechanism success and adoption are separate.
- For the current harness and workload, the default remains one Worker.
