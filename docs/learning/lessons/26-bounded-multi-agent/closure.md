# 26 — Closure

Status: **CLOSED by Topic Chat on 2026-09-28**.

Mechanism: **SWM01 PASS**.

Adoption: **not adopted as the default path**.

## What was learned

The module established a bounded multi-agent topology:

```text
objective
→ Lead proposes semantic decomposition
→ harness admits 2–3 workers
→ fresh read-only workers execute concurrently
→ structured child reports
→ Lead semantic synthesis
→ frozen external grader
```

The important concept is the topology and its authority boundaries, not a special swarm primitive or `Promise.all` itself.

Module 13 and Module 26 form a continuum. Module 13 uses one bounded child as an auxiliary Worker capability. Once a parent dynamically allocates substantial parts of one objective across several sibling contexts and must coordinate budgets, overlap, failures, fan-in, and synthesis, the problem has become the Module 26 system-level coordination problem.

## Authority boundary

The Lead may propose **what** to investigate.

The harness retains **how much authority and resource** that proposal receives:

- 2–3 workers;
- one wave;
- fixed model;
- bounded turns;
- read-only repository access;
- no recursive delegation;
- no write or command execution.

An over-budget or authority-expanding plan fails closed.

## Handoff boundary

Workers return structured evidence, not raw conversations.

A child may cite only repository paths it actually read. The final Lead may cite only paths exported by successful child reports.

This means the final synthesis is the system output. A useful discovery that remains only inside a child context does not count as final-system coverage.

`droppedChildEvidencePaths` records path omission during fan-in; it deliberately does not claim semantic finding preservation.

## Failure and verification

A failed child remains explicit in synthesis and is not automatically respawned. Partial evidence may still be useful, but incomplete coverage cannot silently become full coverage.

Agreement among several workers is not VERIFY. Workers can share the same incorrect assumption, source, wording ambiguity, or model bias. Independent grading/deterministic verification remains separate authority.

## Experiment evidence

Deterministic harness suite after review fixes: **335 passed, 0 failed**.

### Initial pair — base `f992e3a`

| Arm | Wall | Input tokens | Coverage | Correctness |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 70,200 ms | 174,332 | 8/9 | 0.25 |
| Variant | 107,213 ms | 621,400 | 9/9 | 0.7778 |

The variant improved the frozen grade on this pair, but used about **3.56×** baseline input tokens and was about **53% slower** end to end. Its recorded mechanism flag was false only because the probe initially counted the harness-created `target-app/node_modules` symlink as a worker mutation; the review fix preserved the cleanliness requirement and corrected the baseline.

### Fresh pair after review fixes — base `828eafa`

| Arm | Wall | Input tokens | Coverage | Correctness |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 46,894 ms | 209,701 | 8/9 | 0.25 |
| Variant | 89,073 ms | 615,951 | 8/9 | 0 |

`mechanismPass=true`. Workers genuinely overlapped. One child hit `max_turns_exceeded`; the failure stayed visible and was not respawned.

### Third pair — same base/model/grader

| Arm | Wall | Input tokens | Coverage | Correctness |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 88,096 ms | 290,930 | 8/9 | 1.0 |
| Variant | 90,206 ms | 533,716 | 7/9 | 0.7143 |

`mechanismPass=true`. All three workers succeeded and overlapped. The variant used about **1.83×** baseline input tokens with about **2% higher** end-to-end wall time.

## Interpretation

The mechanism works.

The current repository-audit workload does **not** show a stable benefit large enough to justify default adoption.

That is not evidence that multi-agent systems are generally ineffective. It is workload-bounded evidence that real parallel execution can still lose after accounting for:

- planning;
- duplicated exploration;
- extra context/tokens;
- handoff;
- synthesis loss;
- final-system quality.

Use bounded multi-agent investigation when the workload has genuinely independent breadth-first directions and there is a measurable coverage or latency problem worth paying coordination cost for.

Default remains:

```text
Spec → one Worker → VERIFY / repair → independent REVIEW / review repair
```

## Final Understanding Check

Result: **PASS with precision corrections**.

The learner correctly understood:

1. concurrency primitives are not the multi-agent architecture by themselves;
2. Module 13 → Module 26 is a continuum;
3. the harness, not the Lead, owns resource and capability authority;
4. the final synthesis is the externally meaningful system result;
5. mechanism success and adoption/ROI are separate questions.

Precision retained:

- fresh focused contexts can improve breadth or reduce context pressure, but are not inherently higher quality;
- consensus among workers is not independent verification;
- evidence-path survival is not proof that a semantic finding survived synthesis.

## Remaining boundaries

Not implemented or justified by this module:

- recursive spawning;
- multi-round swarms;
- peer/free-form agent chat;
- shared mutable blackboard memory;
- voting/consensus as verification;
- generic scheduling/auction/routing;
- persistent swarm state;
- deep organizational hierarchy;
- production swarm platform.

Those remain separate future questions rather than hidden requirements of SWM01.
