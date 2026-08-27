# AI-Native Learning Process

This document defines the operating process for the one-month AI-native / agentic engineering intensive.

## 1. Single source of truth

The GitHub repository is the **only durable source of truth**:

```text
Repository: i-kohan/ai-native-learning
Branch: main
```

Permanent project documents live in the repository:

```text
docs/learning/master-learning-plan.md
docs/learning/learning-process.md
docs/learning/learning-cheatsheet.md
docs/learning/deep-research-report.md
docs/learning/progress.md
docs/learning/experiments.md
docs/learning/lessons/
.cursor/rules/learning-harness.mdc
```

Architecture docs, evals, traces, skills, capstone code, and compact lesson recaps also live there.

The ChatGPT Project is used only as a workspace for:

- `00 — Master / Roadmap`;
- Topic Chats created as modules are reached;
- optional temporary debugging chats when necessary.

Do not maintain duplicate permanent documents in the ChatGPT Project. If repository documents and chat context disagree, the current GitHub version wins.

If a durable decision appears in a chat and matters to future modules, move it into the appropriate repository document. Chat history is not durable project state.

---

## 2. Master Chat

Master owns roadmap-level decisions, not deep teaching or implementation.

Before choosing or closing a module, Master must read current GitHub state:

```text
required:
  docs/learning/master-learning-plan.md
  docs/learning/progress.md

when relevant:
  docs/learning/experiments.md
  docs/learning/learning-process.md
  docs/learning/lessons/<current-module>/
  docs/architecture/*
  relevant implementation / eval code
```

Master should not ask the user to upload or paste repository documents when GitHub is available.

When Master selects the next module, it always produces a ready-to-copy Topic Chat starter prompt containing:

- current progress;
- current harness version/state;
- module place in the roadmap;
- why it comes now;
- what the user must understand;
- practical outcome;
- explicit scope / non-goals;
- relevant repository paths the Topic Chat may inspect.

The starter prompt defines **boundaries and priorities**, not a requirement to lecture through every listed bullet at equal depth. Prefer the shortest prompt that still prevents scope drift and preserves the module's critical distinctions.

---

## 3. Topic Chat

Each major module gets one Topic Chat when needed.

Topic Chat works in this sequence:

### Content density / minimum-sufficient explanation

Optimize for **understanding per unit of attention**, not maximum coverage.

Default teaching shape:

```text
core problem / why
→ core mental model
→ key execution flow
→ 1–2 concrete examples
→ important boundaries / trade-offs / failure modes
→ our harness
→ frontier / production lens
```

Rules:

- do not treat the starter prompt as a checklist that requires a long explanation for every bullet;
- combine overlapping concepts instead of defining near-synonyms separately when one distinction is sufficient;
- prefer one strong concrete example over several weak examples;
- omit edge cases, taxonomy, provider features, or production machinery that do not materially change the current concept;
- explain extra detail when it is learning-critical, current-harness-critical, or requested by the user;
- use the user's follow-up questions to deepen only the parts that remain unclear;
- a shorter Topic is better when it preserves the same mental model, execution flow, important boundaries, and ability to reason about the mechanism.

The goal is **minimum sufficient depth**, not superficiality: core topics can still be deep, but depth should come from causal understanding and concrete execution, not repetition or exhaustive enumeration.

### Complexity / mechanism admission guardrail

A roadmap topic does **not** imply that its mechanism must become permanent harness architecture.

Before adding a new runtime mechanism, ask:

```text
What current workload / failure mode justifies this mechanism?
Can the concept be learned with a bounded probe instead?
What evidence would justify adopting it into the normal path?
```

If there is no real current need:

- understand the concept;
- run a small controlled experiment only if useful;
- allow a negative / no-adoption conclusion;
- do not build a framework merely to complete the roadmap.

Controlled probes and representative capability benchmarks must remain distinct. As orchestration mechanisms become more sophisticated, benchmark/workload complexity should grow enough to make the mechanism meaningfully testable rather than manufacturing a mechanism-friendly toy task.

Do not let experimental switches and scaffolding accumulate forever. After Phase 3, perform a small consolidation pass: keep normal architecture, retain only useful experimental seams, remove obsolete scaffolding, and capture a compact current architecture map before Durable Execution.

### Language / terminology convention

The teaching language can remain primarily Russian, but important industry vocabulary should stay recognizable in English.

When a non-obvious English technical term is introduced for the first meaningful time in a module/section, write it as:

```text
English term (короткий русский перевод / понятный смысл)
```

Examples:

```text
progressive disclosure (постепенное раскрытие контекста)
escape hatch (запасной путь / возможность выйти за первоначальный выбор)
provenance (происхождение / источник информации)
eager context (контекст, который даём заранее)
on-demand discovery (поиск информации по мере необходимости)
```

Rules:

- preserve the English term so it becomes familiar for documentation, interviews, papers, and tooling;
- give a short Russian translation or plain-language meaning on first use when the term may not be obvious;
- if a literal translation is awkward or misleading, explain the practical meaning instead of forcing a word-for-word translation;
- after a term has been established, it does not need parentheses on every repetition;
- do not translate code identifiers, API names, product names, or trivial common programming words just for the sake of translation;
- lesson `theory.md` files should preserve the key English vocabulary and may include a compact vocabulary section when several new terms matter to the module.

The goal is to understand the concept in Russian **and** become comfortable recognizing and using the standard English terminology.

### Stage 1 — Understand

Explain:

- the engineering problem;
- why the current harness is insufficient;
- mechanism and execution flow;
- practical examples;
- patterns;
- trade-offs;
- failure modes;
- when not to use the technique.

Do not start implementation before the principle is understood well enough for the topic's roadmap priority.

### Stage 2 — Connect to capstone

Connect the concept to the current GitHub harness and propose the smallest real change that demonstrates it.

Do not implement future roadmap modules early.

### Stage 3 — Learning-critical vs delegatable

Before Cursor Task, explicitly split implementation into:

**Learning-critical**

- architecture / execution flow the user must understand;
- 3–5 concrete files/functions the user should inspect after implementation;
- the execution path the user must be able to explain.

**Delegatable**

- boilerplate;
- plumbing;
- trivial helpers;
- repetitive tests/configuration when they are not the learning subject.

Cursor can write most of the code; the user must understand the learning-critical logic.

### Stage 4 — Experiment

Before implementation define:

- hypothesis;
- baseline;
- variant;
- metrics / evidence;
- decision rule.

### Stage 5 — Cursor Task

Produce a compact task describing:

- goal;
- implementation scope;
- learning-critical areas;
- constraints / non-goals;
- required tests/checks;
- requested experiment;
- documentation/result updates.

### Stage 6 — Review + lesson recap

After Cursor work, Topic Chat analyzes implementation and experiment results, checks understanding, and decides whether the module is complete.

Before handing the module back to Master, ensure the module lesson folder contains:

```text
docs/learning/lessons/NN-short-name/
  theory.md
  notes.md
  traces/   # optional representative evidence
```

`theory.md` is a **3–5 minute refresher**, not a textbook. It should contain only:

- core mental model / key definitions;
- mechanism / execution flow;
- important boundaries;
- main failure modes / trade-offs;
- 2–4 concrete observations from our implementation/experiments that confirm, challenge, or qualify the theory;
- 3–6 takeaways worth remembering.

`notes.md` remains the practical/personal module journal: implementation nuances, commands, surprising behavior, concrete results, and personal takeaways.

Do not duplicate large sections from `master-learning-plan.md` or `deep-research-report.md` into lesson files.

If more repository context is needed, Topic Chat should read GitHub directly rather than ask for duplicated files.

---

## 4. Cursor implementation flow

Cursor follows `.cursor/rules/learning-harness.mdc`.

For substantial module implementation:

1. read current `progress.md`, relevant docs, architecture, and code;
2. read `experiments.md` if prior results matter;
3. show a short proposed implementation plan before major changes;
4. implement the smallest real version needed for the current module;
5. run required tests/checks;
6. run the requested experiment;
7. give a short code tour:
   - 3–5 main files/functions the user should personally inspect;
   - role of each;
   - execution flow between them;
8. update `docs/learning/progress.md`;
9. update `docs/learning/experiments.md` when an experiment was run;
10. update the current module `notes.md` with practical results and help maintain a compact `theory.md` when the Topic Chat has established/closed the theory;
11. after user review and Topic Chat closure, commit and push the completed module state.

If implementation reveals a durable architecture/workflow decision, update the appropriate repository document as part of the same module work.

---

## 5. Git workflow

Human learning Git flow stays sequential on `main`:

```text
module
→ implementation
→ tests / experiment
→ code review / understanding
→ lesson recap
→ progress update
→ commit
→ push
```

Harness task execution now uses per-run Git worktrees (Module 08). That is isolation for agent/benchmark runs, not a new human branching workflow.

Do not introduce parallel human module development, long-lived feature branches, or extra worktrees for learning work unless a later module requires them.

---

## 6. Definition of Done for a module

A module is not complete just because code works.

Topic Chat checks, at the depth appropriate to the topic priority:

```text
PROBLEM / WHY             ✅ / ❌
CORE MECHANISM            ✅ / ❌
KEY EXECUTION FLOW        ✅ / ❌
IMPLEMENTATION            ✅ / ❌
LEARNING-CRITICAL CODE    ✅ / ❌
VERIFICATION / EXPERIMENT ✅ / ❌
FAILURE MODES             ✅ / ❌
TRADE-OFFS                ✅ / ❌
WHEN NOT TO USE           ✅ / ❌
THEORY RECAP              ✅ / ❌
PRACTICAL NOTES/EVIDENCE  ✅ / ❌
```

Level A topics require deeper mastery than Level B or Level C topics.

---

## 7. End-to-end workflow

```text
Master → Topic Chat → Cursor → Topic Chat → GitHub → Master
```

**Master**
reads current GitHub state → selects the next module → produces a ready Topic prompt.

**Topic Chat**
teaches → connects to capstone → defines experiment → separates learning-critical/delegatable code → produces Cursor Task.

**Cursor**
shows implementation plan → implements → tests/experiment → code tour → updates docs.

**Topic Chat**
reviews results → checks understanding → writes/validates compact lesson recap → closes module.

**GitHub**
receives commit/push and becomes the current durable state.

**Master**
reads the new state and starts the next cycle.

The process should stay this simple unless a roadmap module intentionally introduces new complexity.
