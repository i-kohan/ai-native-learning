# 24 — Memory Architectures

## Mental model

Memory is not “whatever the model saw before.” It is selected information retained outside the current invocation so that a later run may retrieve it.

```text
past run
→ observation / outcome
→ MemoryCandidate
→ harness admission
→ MemoryRecord
→ later retrieval
→ current-world validation
→ bounded working context
→ model
```

Keep these layers separate:

```text
Context / working memory
= what the model sees now

Session / previous_response_id
= continuation of the same interaction / episode

WorkflowState
= authoritative semantic state of this workflow

Trace
= historical record of what happened

Repo docs / config
= maintained shared knowledge / authority

Skill
= reusable procedure for how to do something

MemoryRecord
= selected cross-run knowledge learned from prior work
  that may be useful again, but must be revalidated
```

Memory therefore becomes context only after retrieval and validation. It never silently becomes workflow authority.

## Memory types

Useful distinctions:

- **Working / short-term memory** — current context only; it disappears with the episode.
- **Semantic memory** — distilled fact, for example an implementation-surface fact. It can become stale.
- **Episodic memory** — a past event with time, provenance, and outcome.
- **Procedural memory** — a recurring method. If it becomes stable and maintained, promote it into a Skill/runbook rather than leaving it as loose memory.

For this module we implement only one narrow repository-scoped **semantic** memory mechanism.

## Lifecycle and write authority

The safe lifecycle is:

```text
observation
→ candidate
→ admission
→ persist
→ retrieve
→ validate against current world
→ use as hint
→ later supersede / expire / delete if the system supports those policies
```

The critical boundary is:

```text
model / run may produce evidence
≠
model may write trusted durable memory directly
```

Admission is harness-owned. Before persistence, the harness should know why the fact is worth carrying, what scope it belongs to, what evidence supports it, and what current authority could later invalidate it.

For MEM01, model narration is not an admission input. The harness derives a structured implementation-surface claim from repository files only after workflow success, VERIFY PASS, and independent REVIEW pass.

## Authority hierarchy

Exact ordering is claim-dependent, but the default principle is:

```text
current executable evidence / verifier
> current authoritative repo state / config / docs
> WorkflowState for workflow facts
> currently validated memory
> unvalidated historical memory
> model inference
```

Examples:

- for “what phase is this workflow in?” → `WorkflowState` wins;
- for “what code exists now?” → current repository evidence wins;
- for “what behavior is required?” → resolved Spec / authoritative requirements win;
- memory stays a prior / hint.

A prior VERIFY+REVIEW PASS makes a memory well-supported **historically**. It does not make it eternal repository truth.

## Scope before relevance

A memory can be semantically relevant and still be invalid because it belongs to another repository, project, user, or environment.

```text
scope filter
→ candidate lookup / relevance
→ freshness / applicability validation
→ bounded injection
```

MEM01 deliberately does not build a generic relevance engine. Retrieval is explicit and probe-bounded; within the selected repository it admits a hint only when exactly one record validates. If this mechanism were generalized, task-class/tag/path relevance should become an explicit filter before ranking/injection.

Vector databases, embeddings, and semantic search are implementation choices, not the definition of memory architecture.

## Provenance and freshness

A durable fact needs enough provenance to answer:

> Why did we believe this, and what current evidence can invalidate it?

The MEM01 record keeps:

- repository scope;
- structured claim;
- source path and anchor;
- operations that supported the claim;
- source fingerprint;
- workflow **base revision**;
- observation time;
- originating workflow/run;
- VERIFY/REVIEW evidence.

Important nuance: `baseRevision` is the starting revision of the workflow that produced the memory. The exact bytes observed at promotion are represented more directly by the structured observation plus `sourceFingerprint`. Do not read `baseRevision` as “the final committed tree containing the observation.”

At retrieval time, provenance is compared with the **current** repository.

A changed file hash does not automatically mean a semantic claim is false. For MEM01 the claim is structural:

```text
Task routes delegate core task-domain operations
to TaskService in target-app/src/tasks/task-service.ts
```

So validation asks whether the path, class anchor, and delegated operations still support the claim. The fingerprint remains provenance; it is not the only freshness criterion.

If applicability cannot be established, fail closed and inject nothing.

## Stale, superseded, deleted

Conceptually:

```text
stale
= the old record is no longer safe to use as a current fact

superseded
= a newer supported fact replaces the old current fact

deleted
= the information should no longer be retained at all
```

MEM01 only implements runtime stale/incompatible rejection. It intentionally does not build supersession, TTL, decay, deletion, or automatic rewrite policies.

A stale historical memory may have been perfectly correct when it was recorded.

## Memory poisoning and false-belief feedback loops

Durable memory increases the blast radius of bad inputs. A malicious README, issue, tool result, MCP result, web page, or model inference must not directly become trusted durable memory.

The dangerous loop is:

```text
bad / incomplete memory
→ biases a future run
→ the run notices confirming evidence
→ that same biased reasoning rewrites / strengthens memory
→ future runs trust the stronger false belief
```

The key rule is:

> Memory must not be its own proof.

MEM01 reduces this risk by deriving a narrow structured claim from current repository evidence and promoting only after the normal VERIFY + independent REVIEW outcome. Failed validation does not rewrite the stored record.

The current probe also constrains claim text to harness-generated structure rather than arbitrary model prose.

## Session continuity vs cross-run memory

These solve different problems.

```text
session continuity
= continue the SAME interaction
  using conversation/provider state

cross-run memory
= start a NEW interaction,
  retrieve selected knowledge from an OLD run
```

MEM01 Process B uses a fresh workflow and manual conversation mode with no `previous_response_id`. The useful prior fact comes from `MemoryStore`, not from conversation continuation.

## Eval contamination

Memory can be useful system behavior and still invalidate an evaluation.

If trial 1 writes a holdout answer into memory and trial 2 retrieves it, trial 2 no longer measures the same unseen-task condition.

For strict qualification:

```text
same task snapshot
+ same harness/model config
+ same memory state
```

The current qualification path does not wire memory into HOLDOUT runs, so Module 24 leaves qualification effectively empty-memory by default. A future evaluation of memory itself should use controlled arms, for example memory-disabled vs the same predefined seeded memory.

## MEM01 — implemented mechanism

Process A:

```text
T02
→ Spec
→ Worker
→ VERIFY PASS
→ independent REVIEW pass
→ observe current implementation surface
→ propose candidate
→ harness admission
→ persist MemoryRecord
```

Process B:

```text
fresh T03
→ derive repository scope from bound config.repoRoot
→ load in-scope record
→ validate against current tree
→ inject one advisory Worker hint
→ normal Worker / VERIFY / REVIEW
```

Negative case:

```text
same stored record
→ isolated workspace removes TaskService anchor
→ retrieval finds candidate
→ validation = anchor_missing
→ no hint injected
→ stored record unchanged
→ normal repository discovery remains available
```

Latest authoritative MEM01 re-run:

- T02: workflow success, VERIFY PASS, REVIEW pass, one memory admitted;
- wrong repository scope: retrieved 0 / injected 0;
- fresh T03: retrieved 1 / validated 1 / injected 1, no `previous_response_id`;
- T03 still used `read_file` 4 times before/through implementation discovery;
- stale workspace: `anchor_missing`, injected 0, record unchanged.

This proves the lifecycle mechanism. It does **not** prove a quality, navigation-cost, latency, or token improvement.

## Current implementation boundaries

The mechanism is intentionally narrow:

- one repository-scoped `implementation_surface` kind;
- one task-domain observer, not generic memory extraction;
- no embeddings/vector DB/ranking platform;
- no transcript/trace auto-ingestion;
- no generic supersession/TTL/deletion;
- no durable-execution integration; durable + memory is rejected as `unsupported_mode`;
- no automatic adoption on the normal path;
- retrieval relevance is explicit/probe-bounded rather than a general task matcher.

`repositoryScopeOf()` currently uses the bound Git `origin`. On this repository the origin is the non-secret SSH identity `git@github.com:i-kohan/ai-native-learning.git`. A production/generalized memory system should canonicalize/redact credential-bearing remote URLs before persisting or tracing repository identity.

## Adoption decision

Keep memory **off by default**.

The probe shows that verified cross-run knowledge can be retained and safely revalidated, but this small task repository is cheap for the Worker to rediscover. One successful mechanism probe is not evidence that always-on memory earns its context, admission, storage, retrieval, and staleness-management cost.

Revisit when repeated cross-run facts are common and expensive enough to rediscover that a bounded, validated hint has measurable end-to-end value.

## Takeaways

- Context is what the model sees now; memory is retained outside the current invocation.
- WorkflowState is workflow authority; memory is cross-run evidence/hint.
- Trace is history; memory is selected information worth carrying forward.
- Stable official knowledge belongs in docs/config/executable constraints.
- Stable reusable procedure belongs in a Skill/runbook.
- Scope before relevance; validate before use.
- Provenance explains why the fact was believed; freshness asks whether it still applies now.
- Memory must not be its own proof.
- Useful memory can contaminate evals if memory state is not controlled.
- A working memory mechanism does not imply default adoption.
