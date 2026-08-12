# AI-Native / Agentic Engineering — Master Learning Plan (August 2026)

## 0. Purpose of this document

This is the **source of truth** for a one-month intensive transition from an AI-assisted developer to a much stronger AI-native / agentic engineer.

It is based on:

- the completed deep research on AI-native software engineering / agentic development;
- the later critique that added missing topics such as modern model-native orchestration, agent security, distributed-systems semantics, human reviewability, and stronger eval methodology;
- our discussion about what is worth learning deeply, what should be practical exposure, and what should be postponed until the end.

This document is **not yet a rigid Day 1 → Day 30 calendar**. It defines:
1. what we are learning;
2. why;
3. in what order;
4. how deeply;
5. what we intentionally deprioritize;
6. how one capstone harness evolves through the month;
7. how to work with ChatGPT / other LLMs while learning.

The daily calendar should be generated from this master plan after the scope is fixed.

---

# 1. End Goal

The goal is **not** to become a power user of Cursor, Claude Code, Codex, MCP, LangGraph, or any specific tool.

The goal is:

> Learn to design, build, evaluate, and improve an AI-native software-development system in which coding agents can autonomously execute a significant part of the SDLC, while the human operates mainly at the level of intent, architecture, constraints, policy, evaluation, and exceptions.

By the end of the month, I should be able to:

- explain the architecture of a modern coding-agent harness;
- build a small but real harness myself;
- turn a task / issue into a structured and verifiable specification;
- provide agents with the right context, tools, skills, and environment;
- implement verification → repair → review loops;
- isolate execution using worktrees / sandboxes;
- trace and evaluate agent runs;
- compare models empirically instead of by intuition;
- introduce subagents / multi-agent patterns only when they solve a measured problem;
- persist state and recover long-running work;
- integrate the harness with GitHub / CI;
- reason about agent security and untrusted inputs;
- diagnose failures by layer: model, context, spec, tool, environment, policy, verifier, orchestration, or resources;
- explain which “advanced” techniques did **not** improve the system and why.

---

# 2. The Core Mental Model

The target system looks roughly like this:

```text
Human intent / issue
        ↓
Specification
        ↓
Planning / decomposition
        ↓
Context builder
        ↓
Orchestrator / control plane
        ↓
Coding agent
        ↓
Tools + skills + isolated workspace
        ↓
Implementation
        ↓
Deterministic verification
        ↓
Repair loop
        ↓
Independent review
        ↓
Repair loop
        ↓
Evidence / CI / PR
        ↓
Metrics + traces + evals
```

Around it:

```text
permissions
security
state
retries
budgets
model routing
human escalation
```

The central principle of the month:

> **Do not automate the human. Automate the feedback loop.**

---

# 3. How the Topics Are Prioritized

We use three levels.

## Level A — Core: learn deeply + implement

These are the main skills that define the target role.

- Agent loops
- Harness engineering
- Spec-driven development
- Context engineering
- Tools and capability design
- Deterministic verification
- Test/fix loops
- Review/repair loops
- Tracing
- Evals
- Orchestration fundamentals
- Agent security fundamentals

These topics receive the most time.

## Level B — Practical: understand well + implement at least once

These are important parts of a real harness, but they only make sense after the core works.

- Skills / reusable procedural knowledge
- Worktrees and environment isolation
- Model routing
- Planner / worker / reviewer patterns
- Subagents
- Human-reviewable change decomposition
- Basic durable execution
- Basic distributed-system semantics
- GitHub / CI integration
- Modern model-native orchestration

## Level C — Advanced / conditional: understand, experiment, but do not over-invest

These topics matter, but have lower educational ROI during the first month or are useful only at larger scale.

- MCP beyond basic usage
- Persistent / semantic memory
- Advanced eval statistics
- A2A / agent interoperability
- Large multi-agent swarms
- Deep hierarchical agent organizations
- Production-grade distributed orchestration
- Full-scale zero-trust agent infrastructure
- Self-modifying harnesses
- Multi-repository autonomous software factories

These go near the end because:
- they depend on earlier layers;
- some solve scale problems we do not yet have;
- some are still experimental;
- some can consume days without teaching the central feedback-loop principles.

---

# 4. Full Topic Map — What, Why, Depth, Order

## 4.1 Agent Loop

### What it is

The atomic loop:

```text
model
→ tool/action
→ observation
→ model
→ next action
→ ...
```

A coding agent is not “a model that writes code”. It is a model running inside an action/observation loop.

### Why it matters

Everything else — tools, skills, review, orchestration, retries — modifies or surrounds this loop.

### What to build

A minimal runner:

```text
issue
→ model
→ shell/files/git
→ code change
→ tests
→ result
```

### Depth

**Deep. First topic.**

---

## 4.2 Harness Engineering

### What it is

The system around the model:

```text
model
+ instructions
+ context acquisition
+ tools
+ environment
+ state
+ verification
+ permissions
+ retries
+ observability
+ delivery integration
```

### Why it matters

A strong model can fail badly in a weak environment. Harness engineering is the discipline of turning raw model capability into repeatable engineering outcomes.

### What to learn

- capability boundaries;
- task lifecycle;
- environment design;
- feedback signals;
- failure taxonomy;
- when a failure is a model problem vs a harness problem.

### What to build

The capstone itself is the harness.

### Depth

**Deep. Central theme of the month.**

---

## 4.3 Spec-Driven Development

### What it is

Not “write a longer PRD”.

Convert intent into a versioned, machine-actionable contract.

Example:

```yaml
goal:
requirements:
non_goals:
constraints:
acceptance:
verification:
ambiguities:
```

### Why it matters

Autonomy is impossible if “done” exists only in the human’s head.

### What to build

An issue → spec transformation step.

The harness should distinguish:

- resolvable from repository;
- inferable under a safe default;
- requires human product judgment.

### Depth

**Deep.**

---

## 4.4 Context Engineering

### What it is

Designing what the model sees at each step.

Not:

```text
send the entire repository + all docs + every tool
```

But:

```text
task
+ relevant repo map
+ relevant architecture docs
+ current state
+ active skill
+ minimal tools
+ recent observations
```

### Why it matters

Context pollution, staleness, and bad retrieval can destroy agent performance even when the model is capable.

### What to build

- short `AGENTS.md` / repo map;
- `ARCHITECTURE.md`;
- discoverable docs;
- targeted ContextBuilder;
- progressive disclosure;
- task-scoped tools.

### Experiment

Full-context vs targeted-context.

Measure:
- tokens;
- retries;
- success;
- irrelevant tool usage.

### Depth

**Deep.**

---

## 4.5 Tools and Capability Design

### What it is

What actions the agent can physically perform.

Examples:

- shell;
- git;
- browser;
- database;
- test runner;
- GitHub API;
- logs / observability.

### Key principle

> Use an LLM where judgment is needed. Use deterministic software where the operation is deterministic.

Bad:

```text
LLM decides how to parse JSON
LLM fetches metadata one field at a time
```

Better:

```text
normal code / CLI does deterministic work
agent reasons over the result
```

### Depth

**Deep enough to design tools well; no need to build a generic tool platform.**

---

## 4.6 Verification

### What it is

External evidence that the change works.

Priority of signals:

```text
deterministic acceptance test
> compiler / typechecker / linter
> observable API / DB / browser state
> structured independent reviewer
> self-review
> "agent says done"
```

### Why it matters

The agent must never be the sole authority on completion.

### What to build

A `VerificationReport` mapping acceptance criteria to graders / evidence.

### Depth

**Deep. Core reliability layer.**

---

## 4.7 Test → Fix Loop

### Pattern

```text
IMPLEMENT
→ VERIFY
→ failure
→ diagnose
→ minimal repair
→ VERIFY
```

### Why it matters

This is one of the strongest and most reliable agentic feedback loops because the feedback is executable.

### What to build

- normalized failure reports;
- bounded retries;
- duplicate-failure detection;
- escalation conditions.

### Depth

**Deep.**

---

## 4.8 Independent Review → Repair Loop

### Pattern

```text
implementer
→ diff
→ independent reviewer
→ findings
→ repair
→ review again
```

### Why it matters

Self-evaluation is often optimistic. A clean independent context can provide a better signal.

### Important

This is the first useful multi-agent pattern, but it is intentionally small and bounded.

### What to build

Reviewer receives:

- spec;
- diff;
- architecture constraints;
- test evidence.

Preferably it does **not** receive the implementer’s justifications.

### Depth

**Deep/practical.**

---

## 4.9 Tracing

### What it is

Episode-level observability:

```text
task
episode
model
tool
tokens
latency
cost
result
failure class
```

### Why it matters

Without traces, “the agent is bad” is not a useful diagnosis.

With traces:

> 28% of cost is repeated repo discovery  
> 17% of retries come from a missing permission  
> reviewer loops repeat the same finding twice

### What to build

A simple structured event log / trace store.

### Depth

**Deep.**

---

## 4.10 Evals

### What it is

Controlled experiments over a fixed task suite.

### Why it matters

Without evals, every new advanced feature becomes:

> “Feels better.”

We want:

```text
success
autonomous success
first-pass success
human interventions
human active minutes
retry count
cost per success
wall time
defects
```

### Initial scope

Start with **5–6 representative tasks**, not 18 × many configurations.

Later expand.

### Why we reduce the original research scope

The original larger benchmark is methodologically good, but too expensive and time-consuming for the first month.

The objective is to learn eval-driven engineering, not to produce publication-grade statistics.

### Depth

**Deep. One of the main disciplines.**

---

# 5. Topics Added After the Original Research

These topics were not absent from the original report, but were underdeveloped relative to their importance.

---

## 5.1 Modern Model-Native Orchestration / Inner vs Outer Loop

### Why we added it

Modern model/provider runtimes can now perform more orchestration internally:

- programmatic tool use;
- internal tool search;
- persisted reasoning;
- model-native subagents;
- provider-side compaction.

This creates an architectural question:

```text
What belongs inside the model/provider runtime?
vs
What must remain in our durable outer harness?
```

### Working model

```text
OUTER LOOP
state / permissions / verification / retry / delivery / evals
      ↓
model invocation
      ↓
INNER LOOP
reasoning / tool orchestration / temporary subagents
      ↓
checkpoint / outcome
      ↓
OUTER LOOP
```

### Why it is not first

You need to understand a normal loop and harness before deciding which responsibilities can be delegated inward.

### Depth

**Practical + architectural.**

---

## 5.2 Agent Security and Untrusted Input

### Why we added it

A coding agent reads potentially hostile data:

- issue text;
- PR comments;
- repository files;
- README;
- generated files;
- web pages;
- MCP responses;
- CI logs;
- package metadata.

Therefore security is not only:

```text
sandbox + permissions
```

It also includes:

```text
prompt injection
tool poisoning
malicious repository content
credential exfiltration
confused deputy
data leakage
supply-chain attacks
unauthorized side effects
```

### What to understand

- trust provenance;
- least privilege;
- secret isolation;
- network mediation;
- capability-based security;
- human gates;
- auditability.

### What to build

Enough to make the harness safe by construction:

- no direct push to protected branch;
- scoped credentials;
- restricted network;
- isolated workspace;
- explicit high-risk gates.

### Why we do not go production-deep

Enterprise-grade agent security can become a separate field. The first-month goal is correct threat-model thinking, not a complete zero-trust platform.

### Depth

**High importance, practical implementation.**

---

## 5.3 Orchestration as a Distributed System

### Why we added it

Once work runs for a long time or across workers, classic distributed-system problems appear.

Example:

```text
Worker A owns task
→ A becomes unresponsive
→ orchestrator starts B
→ A wakes up again
```

Who owns the task now?

### Concepts

- idempotency;
- leases / ownership;
- heartbeats;
- deduplication;
- stale workers;
- cancellation;
- concurrency control;
- backpressure;
- rate limits;
- reconciliation;
- task versioning.

### What to build

Only the minimal subset:

- persistent task ownership;
- idempotent retries;
- stale worker protection;
- checkpoint / resume.

### Why not deeper

A full distributed workflow engine would steal time from agent engineering.

### Depth

**Important conceptual module + small implementation.**

---

## 5.4 Human Reviewability / Change Decomposition

### Why we added it

A system can be highly autonomous and still create a worse human workflow if it produces huge, hard-to-review changes.

The real scarce resource is often **human attention**.

### What to optimize

Not just:

```text
task success
```

but:

```text
verified software / human attention
```

### Useful metrics

- human review minutes;
- diff / PR size;
- rework after review;
- time-to-merge;
- review findings.

### What to build

Planner can decide whether a large feature should become multiple logical changes / stacked PRs.

### Why it belongs later

You first need a working spec/planning/delivery pipeline before optimizing its outputs for human review.

### Depth

**Practical.**

---

## 5.5 Stronger Eval Methodology

### Why we added it

A difference like:

```text
84% vs 88%
```

may be random variance.

### Concepts to understand

- repeated trials;
- dev vs holdout tasks;
- benchmark contamination;
- grader calibration;
- flaky graders;
- paired comparisons;
- confidence / uncertainty;
- model snapshot drift;
- task-distribution drift.

### What we do NOT do

No full statistics course.

### Depth

**Necessary minimum after basic evals work.**

---

## 5.6 Harness Evolution / Removing Scaffolding

### Why we added it

A workaround that helps one model today may hurt a stronger model later.

A good harness should not only accumulate rules; it should be able to remove unnecessary scaffolding.

### Principle

```text
failure
→ add harness mechanism
→ eval

later:
new model / environment
→ re-run ablation
→ remove mechanism if no longer useful
```

### Depth

**Architectural principle, integrated into eval work.**

---

# 6. Important Topics Kept From Research, But Intentionally Deprioritized

These are not “bad” topics. They are moved later because their value depends on earlier layers or because they solve scale problems we do not yet have.

---

## 6.1 Skills

### Why important

Reusable procedural knowledge:

```text
add-database-migration/
investigate-ci-failure/
run-browser-qa/
review-security-sensitive-diff/
```

### Why after context/spec/verification

A skill only makes sense once we know:

- what repeated procedure exists;
- what context it needs;
- how its output is verified.

### Depth

**Practical. Build several real skills.**

---

## 6.2 Worktrees / Isolation

### Why important

Parallel or autonomous tasks should not share mutable workspace state.

### What to build

Per-task:

```text
worktree
environment namespace
ports
possibly DB namespace
logs
```

### Depth

**Practical.**

---

## 6.3 Model Routing

### Why important

Different tasks may deserve different cost/capability levels.

### Why later

Routing before evals is guessing.

Correct sequence:

```text
eval task classes
→ compare models
→ choose cheapest model meeting the quality SLO
```

### Depth

**Practical, data-driven.**

---

## 6.4 Durable Execution

### Why important

Long-running agent work needs persistent state.

Key principle:

> conversation history != durable state

### Original research depth

The report suggested strong chaos testing, typed retries, recovery, and multi-hour lifecycle handling.

### Our reduced scope

Build:

- persisted task state;
- checkpoint;
- resume;
- basic retry taxonomy;
- a few deliberate failure experiments.

Do **not** build a custom Temporal.

### Depth

**Conceptually important, implementation intentionally limited.**

---

## 6.5 MCP

### Why important

Standardized interface for tools / resources / context.

### Why deprioritized

MCP is not the central orchestration mechanism.

It does not answer:

- when to run an agent;
- how to retry;
- how to verify;
- how to persist state;
- how to review.

It is a capability/interface layer.

### What to do

- understand the protocol;
- use or implement one real MCP integration;
- understand schema/context overhead and when normal CLI/SDK is better.

### Depth

**Basic + one practical exercise.**

---

## 6.6 Memory

### Why important

Agents need durable knowledge and state.

### Preferred hierarchy

```text
ephemeral context
episode state
repository memory
historical analytics
```

### Why deprioritized

A sophisticated vector-memory system is often built before a real need appears.

Repository docs + task state + verified facts solve most of the first-month problems.

### What to build

- repository-local knowledge;
- task checkpoint/state;
- maybe one verified-memory experiment.

### Do not build yet

- large semantic memory platform;
- automatic memory extraction everywhere;
- complex decay/ranking systems.

### Depth

**Conceptual + light practical.**

---

## 6.7 Browser / Visual QA

### Why useful

For UI tasks, browser-observable state may be the strongest acceptance evidence.

### Why conditional

If the capstone repository has meaningful UI, include it.

If not, do not force it just to check a box.

### Depth

**Conditional practical.**

---

# 7. Lowest-Priority / End-of-Plan Topics

These should still be understood so the landscape is complete, but they are deliberately placed at the end.

---

## 7.1 A2A / Agent Interoperability

### What it is

Rough distinction:

```text
MCP ≈ agent/application ↔ capabilities/context
A2A ≈ agent ↔ remote agent
```

### Why last

Useful mainly when building interoperable systems across independent agent runtimes.

Not necessary for understanding a strong coding harness.

### Goal

Understand architecture and use cases. No deep implementation.

---

## 7.2 Large Multi-Agent Swarms

### Why interesting

Potential parallel exploration / specialization.

### Why low priority

- coordination cost;
- duplicated context;
- token cost;
- shared-state conflicts;
- debugging complexity;
- often no measured advantage over one strong agent + good tools.

### Goal

Understand the pattern and run one bounded experiment at most.

---

## 7.3 Deep Agent Hierarchies

Example:

```text
CEO agent
→ manager agents
→ worker agents
→ reviewer agents
```

### Why low priority

Looks advanced, but often introduces a distributed organization before the underlying task demands one.

### Goal

Understand when hierarchy could help at scale; do not build one this month.

---

## 7.4 Production-Grade Distributed Orchestration

### Why low priority

Very important at scale, but easily becomes an infrastructure project rather than an agent-engineering project.

### Goal

Know the problems and patterns, implement only minimal semantics.

---

## 7.5 Sophisticated Semantic Memory

### Why low priority

High implementation complexity with unclear benefit until simple repository state and context engineering are exhausted.

### Goal

Understand retrieval/staleness trade-offs. Avoid premature architecture.

---

## 7.6 Self-Modifying Harnesses

### Why last

Highly experimental and potentially unsafe.

### Better first-month interpretation of “self-improving”

```text
real failure
→ add regression eval
→ modify harness
→ rerun benchmark
→ keep only measured improvements
```

The **engineering loop** improves the harness; the harness does not autonomously rewrite itself without control.

---

# 8. Capstone Strategy

We learn everything through **one evolving project**, not through isolated toy demos.

## V0 — Minimal Runner

```text
issue
→ single coding agent
→ diff
→ tests
→ trace
```

Learn:
- agent loop;
- tools;
- basic harness;
- trace.

---

## V1 — Spec-Driven

Add:

```text
issue
→ structured spec
→ acceptance criteria
→ implementation
```

Learn:
- SDD;
- ambiguity;
- intent preservation.

---

## V2 — Verification + Repair

Add:

```text
implementation
→ verifier
→ repair
→ verifier
```

Learn:
- feedback loops;
- termination;
- external truth.

---

## V3 — Independent Review

Add:

```text
verified diff
→ reviewer
→ findings
→ repair
```

Learn:
- evaluator separation;
- bounded multi-agent use.

---

## V4 — Context + Skills

Add:

- ContextBuilder;
- repo map;
- progressive disclosure;
- several procedural skills.

Learn:
- context quality;
- reusable procedural knowledge.

---

## V5 — Isolation + Security

Add:

- per-task worktree;
- scoped permissions;
- network / secret restrictions;
- basic untrusted-input threat model.

Learn:
- safe autonomy;
- capability boundaries.

---

## V6 — Evals + Routing

Add:

- fixed task suite;
- repeated trials;
- metrics;
- model comparison;
- routing policy.

Learn:
- eval-driven engineering;
- cost/quality optimization.

---

## V7 — Durable Orchestration

Add:

- persistent task state;
- checkpoint / resume;
- task ownership;
- retry semantics;
- basic stale-worker protection.

Learn:
- long-running execution;
- distributed-system thinking.

---

## V8 — Production Workflow

Add:

```text
GitHub issue
→ harness
→ branch/worktree
→ verified PR
→ CI
→ CI repair
→ evidence
```

Optionally:
- planner/worker;
- bounded fan-out;
- browser QA;
- reviewable stacked changes.

Learn:
- real SDLC integration;
- orchestration;
- human-reviewable delivery.

---

# 9. Benchmark Strategy

Do not wait until the end to add evals.

## Initial task suite

Start with 5–6 tasks covering different failure modes:

1. simple bug;
2. multi-file bug;
3. small feature;
4. cross-layer feature;
5. refactor with regression risk;
6. one ambiguous task where escalation is correct.

If the project has UI, replace/add one browser task.

## Compare versions

Examples:

```text
baseline assisted workflow
vs
single autonomous agent
vs
spec-driven
vs
repair loop
vs
independent reviewer
vs
routing
vs
bounded multi-agent
```

## Core metrics

- task success;
- autonomous success;
- first-pass success;
- human interventions;
- human active minutes;
- retry count;
- wall time;
- cost per successful task;
- review findings;
- escaped defects.

## Later advanced eval concepts

Only after the basic eval loop works:

- repeated trials;
- holdout set;
- grader quality;
- variance;
- paired comparisons;
- regression thresholds.

---

# 10. How to Study Each Topic

Every topic should use the same loop.

## Step 1 — Understand

Read a small number of primary sources.

Goal:
- understand the problem;
- understand the mechanism;
- understand trade-offs.

Do not spend hours collecting articles.

## Step 2 — Explain Back

Before coding, be able to answer:

1. What problem does this solve?
2. Why is the previous version insufficient?
3. What new failure modes does this introduce?
4. How will I know if it helped?

If those are unclear, the topic is not understood yet.

## Step 3 — Implement

Add the smallest real version to the same capstone harness.

## Step 4 — Experiment

Compare against the previous version.

Example:

```text
reviewer OFF
vs
reviewer ON
```

or:

```text
full context
vs
targeted context
```

## Step 5 — Write a short conclusion

For each topic keep:

```text
What I expected
What I implemented
What happened
Metrics
Failure modes
When I would use it
When I would not use it
```

This becomes interview material.

---

# 11. How to Use Chats / LLMs During the Month

## Do NOT use one giant chat for the entire month

Reason:

- context becomes polluted;
- early assumptions remain sticky;
- unrelated topics occupy context;
- it becomes hard to know what is source of truth.

## Recommended structure

### A. One Master Chat

Purpose:

- maintain roadmap;
- decide next topic;
- review progress;
- change priorities;
- connect concepts;
- update this master plan.

Give it:
- this `master-learning-plan.md`;
- the deep research report when needed;
- progress summaries from topic chats.

Do not use it for every detailed implementation problem.

### B. One Chat Per Major Topic / Module

Examples:

```text
01-agent-loop-harness
02-spec-driven-development
03-context-engineering
04-verification-repair
05-evals-tracing
06-skills-tools
07-isolation-security
08-routing
09-orchestration-subagents
10-durable-execution
```

Purpose:
- deep explanation;
- source reading;
- implementation design;
- experiments;
- questions.

### C. Coding / Debugging Chats Can Be Separate

If a module creates a large technical debugging thread, open a temporary coding chat.

Return only the useful conclusion to the topic chat / master chat.

---

# 12. What Context to Give a New Topic Chat

Do **not** dump the full deep research into every chat by default.

Give:

1. this master plan;
2. the specific section for the current topic;
3. current capstone architecture / repo state;
4. relevant benchmark results;
5. only the relevant research excerpts or source links.

Use the full research report when:
- the topic has many dependencies;
- you want source-grounded validation;
- there is ambiguity about why the topic is in the plan.

This preserves context quality.

---

# 13. Suggested Prompt for a Topic Chat

Use something like:

```text
I am following the attached master learning plan for AI-native / agentic engineering.

Current module: <TOPIC>.

My current harness version: <Vx>.
Relevant architecture: <short summary>.

My goal in this chat is:
1. understand the topic deeply enough to explain the engineering problem;
2. read only the most important primary sources;
3. design the smallest useful implementation in my harness;
4. define an experiment against the previous version;
5. understand failure modes and when NOT to use the technique.

Do not turn this into a generic tutorial.
Keep tying the topic back to my harness and the learning plan.

At the end of the module I want:
- concepts I must know;
- implementation completed;
- experiment results;
- concise engineering conclusions;
- interview questions I should be able to answer.
```

---

# 14. What to Keep in the Repository

The repository itself should become part of the learning system.

Suggested structure:

```text
/docs
  /learning
    master-learning-plan.md
    progress.md
    decisions.md
    experiments.md

  /architecture
    harness-architecture.md

/evals
  tasks/
  results/

/skills

/traces

/harness

/example-repo-or-target-app
```

## `progress.md`

After every module:

```text
Module:
Date:
Built:
Learned:
What improved:
What did not improve:
Open questions:
Next:
```

## `experiments.md`

Each experiment:

```text
Hypothesis:
Baseline:
Variant:
Tasks:
Metrics:
Result:
Decision:
```

This turns the month into a reproducible engineering project, not a collection of chats.

---

# 15. Suggested Learning Order

This is the recommended dependency order, not yet the exact daily schedule.

## Phase 1 — Foundations

1. Agent loop
2. Harness engineering
3. Basic tracing
4. Basic evals
5. Spec-driven development
6. Context engineering
7. Tool / capability design

Why first:
Everything else depends on understanding execution, truth, and context.

---

## Phase 2 — Reliable Autonomy

8. Verification
9. Test/fix loops
10. Independent review/repair
11. Skills
12. Worktrees / isolation
13. Security fundamentals

Why now:
We move from “agent can code” to “agent can operate safely and correct itself”.

---

## Phase 3 — System Optimization

14. Model routing
15. Modern model-native inner orchestration
16. Planner / worker / reviewer
17. Subagents
18. Human-reviewable decomposition
19. Stronger eval methodology

Why now:
We already have a measurable working harness, so optimization is evidence-based.

---

## Phase 4 — Long-Running / Production Thinking

20. Durable execution
21. Checkpoint / resume
22. Retry semantics
23. Orchestration as distributed systems
24. GitHub / CI integration
25. Optional browser QA
26. Bounded parallel fan-out

Why now:
These solve lifecycle and scale problems that only become real once the harness already works.

---

## Phase 5 — Landscape Completion / Advanced Exposure

27. MCP deeper dive
28. Memory architectures
29. A2A / interoperability
30. Large multi-agent systems / swarms
31. Deep agent hierarchies
32. Production-grade distributed orchestration
33. Self-modifying / self-improving systems

Why last:
These are either:
- more specialized;
- scale-dependent;
- experimental;
- lower ROI for the first month;
- or easy to overbuild before the fundamentals are solid.

Goal:
Understand them well enough to discuss and recognize when they are appropriate — not necessarily implement them deeply.

---

# 16. What We Intentionally Do NOT Study Deeply This Month

To protect focus:

- transformer math;
- fine-tuning;
- embeddings in depth;
- vector database comparisons;
- generic prompt-engineering tricks;
- many agent frameworks;
- LangChain / LangGraph / CrewAI APIs by memory;
- every coding-agent product;
- production deployment autonomy;
- large-scale organization simulation with agents.

Why:
These do not directly maximize the target skill: **designing reliable, measurable, autonomous coding-agent systems**.

---

# 17. Definition of Success After One Month

The month is successful if I have:

## Working artifacts

- one evolving coding-agent harness;
- documented architecture;
- 5–10 reusable benchmark tasks;
- traces;
- experiment results;
- several skills;
- isolated task workspaces;
- verification / repair / review loops;
- basic routing;
- persistent task state;
- GitHub / CI integration;
- explicit security model.

## Knowledge

I can explain:

- what belongs in the model vs the harness;
- how specs become executable;
- why context engineering matters;
- how an agent knows it is done;
- when independent review helps;
- why multi-agent is conditional;
- how model routing should be measured;
- how to design task state and retries;
- how to reason about prompt injection / untrusted input;
- how to make agent output reviewable by humans;
- how to evaluate whether a harness change actually helped.

## Engineering mindset

When an agent fails, I do not immediately:

```text
change prompt
use stronger model
rerun
```

I classify the failure:

```text
MODEL
CONTEXT
SPEC
TOOL
ENVIRONMENT
POLICY
VERIFIER
ORCHESTRATION
RESOURCE
```

Then change one layer and rerun the eval.

That is the target transition from AI-assisted development to serious AI-native / agentic engineering.

---

# 18. Immediate Next Step

Do not start studying random topics yet.

Next:

1. freeze this master plan;
2. choose the capstone target repository / application;
3. choose the harness implementation stack;
4. choose the initial 5–6 benchmark tasks;
5. convert **Phase 1** into an exact day-by-day plan;
6. start with V0 rather than designing V8 upfront.

The master plan remains stable; the day-by-day schedule can change based on experiment results and learning speed.
