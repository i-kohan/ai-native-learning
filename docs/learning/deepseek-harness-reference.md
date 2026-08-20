# DeepSeek Harness — Architecture Reference

> Reference implementation notes for the AI-native learning project.  
> Snapshot reviewed: 2026-08-20. DeepSeek Harness is currently a developer preview and may change incompatibly.

Official repository: https://github.com/deepseek-ai/deepseek-harness

## Why this document exists

DeepSeek Harness is useful as a real-world reference for what a more mature, extensible harness can look like.

It is **not** a target architecture that we should copy into the learning harness now. Our current harness should stay deliberately small so that concepts such as spec, context, verification, review, repair, tracing, and evals remain visible and testable.

Use this document as a destination/reference when later modules introduce capabilities that benefit from stronger modularity.

---

## 1. Harness is larger than an agent loop

A useful mental model is:

```text
Harness
├── model access
├── context construction
├── tools / capabilities
├── execution environment
├── state / persistence
├── permissions / policy
├── verification
├── observability
└── agent workflow / loop
```

The agent loop is one component of the harness, not the definition of the harness itself.

In DeepSeek Harness even the default agent loop is replaceable through the same plugin architecture as other capabilities.

### Why this matters for our project

Our current flow:

```text
spec
→ context
→ implementation
→ verification
→ review
→ repair
```

should be understood as **one workflow implemented by the harness**, not as the only possible shape of the harness.

Later we may want different workflows for different task classes, for example:

```text
small change:
spec → implement → verify

production feature:
spec → plan → implement → verify → review → repair

bug fix:
reproduce → diagnose → patch → regression verify
```

---

## 2. "Everything is a plugin"

DeepSeek Harness is built on Cordis. Plugins contribute services, typed events, and reversible registrations/effects to a shared context.

Important examples are themselves plugins or replaceable capabilities:

- model adapter;
- tool registry;
- session log;
- agent loop;
- filesystem / subprocess backends;
- sandbox;
- approval policy;
- persistence;
- telemetry.

The architectural idea is that there is no large privileged application core that must be patched whenever a capability changes. New behavior attaches to an extension point or provides another implementation of a capability.

### What we should take from this now

Think in **capability boundaries**, even if our implementation remains simple.

For example:

```text
Harness
├── Spec policy
├── Context provider
├── Implementation agent
├── Verifier
├── Reviewer
└── Repair policy
```

We do **not** need a plugin framework yet. The useful lesson is to avoid unnecessarily coupling these responsibilities.

---

## 3. Capability seams

DeepSeek describes swappable capabilities as seams. A seam normally has:

1. a service/interface definition;
2. a provider implementing it;
3. a consumer using it.

Example:

```text
filesystem interface
        ↓
local filesystem provider
        ↓
file tools
```

Later the provider could become:

```text
filesystem interface
        ↓
remote sandbox provider
        ↓
exact same file tools
```

The consumer does not need to know where execution physically happens.

### Relation to our learning

This is a useful future design principle for:

- model routing;
- tool providers;
- isolated environments;
- reviewers;
- persistence;
- subagents;
- GitHub / CI integrations.

---

## 4. Profiles and bundles

DeepSeek Harness composes a running harness from configuration layers.

A useful simplified model:

```text
Plugin = one capability / extension
Bundle = packaged group of plugins/config
Profile = named composition of bundles + overrides
```

This enables different harness configurations without cloning the whole system.

Conceptually, our future harness could have presets such as:

```text
frontend-small-task
production-feature
bugfix
ci-review
research-task
```

Each could reuse the same infrastructure while selecting a different workflow, tools, policies, or models.

This is relevant to the long-term goal of building a personal AI-native development workflow rather than relying only on a generic coding-agent UI.

---

## 5. Model != agent != harness

DeepSeek Harness makes model access replaceable behind an adapter boundary.

Mental model:

```text
Harness
  ↓
Agent / workflow
  ↓
Model adapter
  ↓
DeepSeek / OpenAI / Anthropic / other provider
```

Therefore:

- a model is not an agent;
- an agent is not the harness;
- changing the model does not inherently require redesigning the harness.

This becomes especially important when we reach model routing and eval-driven model selection.

---

## 6. Tool registry

Tools are capabilities registered into the runtime rather than hard-coded into one monolithic loop.

Conceptually:

```text
Tool registry
├── read_file
├── edit_file
├── shell
├── git
├── browser
└── custom domain tools
```

The agent receives the tools appropriate to its current scope.

This reinforces two ideas already important in our course:

1. tools are part of harness design;
2. capability scope should be deliberate rather than "give the agent everything".

---

## 7. Session log as durable source of model-visible history

DeepSeek Harness treats the session event log as the durable source from which model history is reconstructed.

A particularly useful invariant is:

> Model-visible information should be reconstructable from durable session state.

Why this matters:

- replay;
- resume;
- debugging;
- traces;
- forks;
- persistence;
- auditability.

This is a useful reference when our learning reaches state, persistence, durable execution, and richer tracing.

---

## 8. Sandbox as a replaceable execution capability

DeepSeek treats sandboxing as an execution capability behind an interface.

The important architecture is not simply "run Docker". It is:

```text
agent/tool
   ↓
filesystem / subprocess capability
   ↓
execution provider
   ├── local machine
   └── isolated sandbox
```

If the filesystem and subprocess providers point to the sandbox, shell commands and file operations can move into the isolated execution world without every tool having to implement sandbox logic independently.

This is a strong example of a capability seam.

---

## 9. What we should NOT copy yet

Do not restructure the current learning harness around:

- Cordis;
- a generic plugin framework;
- dynamic plugin loading;
- profiles/bundles as infrastructure;
- hot reload / plugin lifecycle machinery;
- a general-purpose service container.

Doing that now would add architecture before we have a measured problem that requires it.

The current harness is intentionally pedagogical:

```text
simple architecture
→ observable failure
→ add one mechanism
→ run experiment
→ measure effect
```

That remains the correct approach.

---

## 10. Ideas worth carrying forward

### A. Harness != loop

Treat the loop as one workflow executed inside a broader system.

### B. Design components around capabilities

Keep spec, context, implementation, verification, review, repair, models, tools, and environments conceptually separable.

### C. Prefer replaceable seams where variation is expected

Especially for models, execution environments, tools, persistence, and reviewers.

### D. Multiple workflow presets are a natural later evolution

Different classes of work may need different orchestration while sharing the same harness infrastructure.

### E. Durable model-visible state improves replayability

Important inputs and outcomes should eventually be reconstructable rather than existing only ephemerally inside one process.

### F. Sandbox belongs below tools, not inside every tool

A shared isolated execution provider is cleaner than teaching each tool independently how to isolate itself.

---

## 11. Where this connects to the roadmap

DeepSeek Harness is especially useful as a reference during later modules on:

- tools and capability design;
- sandbox / environment isolation;
- tracing and persistence;
- model routing;
- subagents / multi-agent patterns;
- permissions and approval policies;
- durable execution;
- harness architecture evolution.

When one of those modules begins, compare our deliberately minimal implementation with the corresponding DeepSeek capability **after** understanding and testing the underlying concept ourselves.

---

## Bottom line

DeepSeek Harness should be treated as a **reference implementation of an extensible agent platform**, not as a blueprint to copy immediately.

The most important architectural takeaway is:

> Build the harness as a composition of responsibilities and capabilities; let agent workflows be replaceable policies running inside that system.

Our learning harness should continue evolving one measured mechanism at a time. If later experiments expose real coupling or reuse problems, the plugin/seam/profile ideas provide a concrete direction for the next architectural step.
