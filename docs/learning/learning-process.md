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
.cursor/rules/learning-harness.mdc
```

Architecture docs, evals, traces, skills, and capstone code also live there.

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

---

## 3. Topic Chat

Each major module gets one Topic Chat when needed.

Topic Chat works in this sequence:

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

### Stage 6 — Review

After Cursor work, Topic Chat analyzes implementation and experiment results, checks understanding, and decides whether the module is complete.

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
10. after user review and Topic Chat closure, commit and push the completed module state.

If implementation reveals a durable architecture/workflow decision, update the appropriate repository document as part of the same module work.

---

## 5. Git workflow

Keep Git simple until the Worktrees / Isolation module:

```text
module
→ implementation
→ tests / experiment
→ code review / understanding
→ progress update
→ commit
→ push
```

Do not introduce worktrees, complex branching strategies, or parallel development before they are the learning subject.

When the roadmap reaches Worktrees / Isolation, change the workflow deliberately as part of that module.

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
reviews results → checks understanding → closes module.

**GitHub**
receives commit/push and becomes the current durable state.

**Master**
reads the new state and starts the next cycle.

The process should stay this simple unless a roadmap module intentionally introduces new complexity.
