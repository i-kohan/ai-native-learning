# Module 25 — A2A / Agent Interoperability — Closure

Date: 2026-09-27

## Decision

**MASTER CLOSED.**

A2A01 is **PASS** as a bounded mechanism probe.

Default architecture remains unchanged:

```text
Spec
→ one implementation Worker
→ VERIFY / bounded repair
→ independent REVIEW / bounded review repair
```

A2A remains opt-in through `a2aDelegationEnabled=false` by default.

## What was demonstrated

```text
Worker
→ delegate_remote_analysis({ objective, scope })
→ Host discovers Agent Card
→ explicit Host admission
→ A2A SendMessage
→ separate local Remote Agent process
→ real remote Task
→ structured ImpactAnalysis Artifact
→ Host schema/path admission
→ advisory Worker evidence
→ normal VERIFY
→ normal independent REVIEW
```

Fresh post-review evidence used `@a2a-js/sdk@1.2.1`, A2A protocol 1.0, HTTP+JSON, a distinct remote `taskId`, persisted `implementation.a2aDelegations`, VERIFY PASS, and REVIEW pass.

Invalid delegated scope, incompatible/missing card capability, and out-of-scope Artifact paths fail closed.

## Understanding check

Final Understanding Check: **PASS with precision corrections**.

The learner correctly understood:

- A2A vs MCP/tool: capability invocation vs delegation to another autonomous agent system;
- A2A vs Subagent: independently operated runtime/service vs harness-owned child reasoning episode;
- Agent Card discovery vs Host admission;
- remote Task completion vs parent workflow success;
- Artifact as untrusted/advisory until Host admission;
- distinct `workflowId`, `delegationId`, `taskId`, and `contextId`;
- timeout-after-send as an ambiguous distributed outcome;
- A2A adoption is conditional, not a default upgrade.

Precision corrections:

1. A2A does not require a literally different harness. The key boundary is an independently operated agent system/runtime that owns its internal execution.
2. `delegationId` is our parent-side identity for one A2A delegation attempt; it is not a Subagent id.
3. `contextId` groups related A2A interactions; it is not memory, a workflow phase, or `WorkflowState`.
4. After a `SendMessage` timeout the Task may exist while the client has no `taskId`. Safe recovery therefore requires reconciliation/dedup/idempotency semantics rather than a blind resend.

## Adoption decision

```text
same harness/runtime/trust/team
→ prefer direct function / tool / Subagent

independent service/team/vendor/runtime
+ autonomous execution
+ separate task lifecycle
+ standardized discovery/task/artifact semantics are useful
→ A2A is a candidate
```

A2A01 does not prove a quality, cost, or latency advantage. Keep the seam off until a real cross-runtime workload justifies it.

## Next

Return to Master for next-module selection. Do not auto-start Module 26 from this Topic Chat.


## Master acceptance

Master review confirmed the intended interoperability and authority boundaries:

```text
official JS SDK                    = @a2a-js/sdk@1.2.1
protocol semantics                 = A2A v1.0
binding                            = HTTP+JSON
separate Remote Agent process      = yes
Agent Card discovery               = real
Host admission                     = explicit
invalid scope before send          = fail closed
real SendMessage                   = yes
remote Task                        = real / distinct taskId
contextId                          = distinct from workflow/task identities
structured Artifact                = schema/path admitted
out-of-scope Artifact              = rejected
parent secrets inherited           = no
remote tools                       = read-only bounded set
delegation record preserved        = implementation.a2aDelegations
remote completion grants success   = false
VERIFY                             = PASS
independent REVIEW                 = pass
default A2A                        = off
```

The current protocol/SDK pin is appropriate for the recorded probe. Current official A2A remains on the stable v1.0 protocol line; SDK package versions evolve independently.

The adoption boundary is accepted:

```text
same harness/runtime/trust boundary
→ direct function / tool / Subagent

independently operated autonomous agent system
+ useful standardized discovery/task/artifact semantics
→ A2A candidate
```

A2A01 is mechanism evidence only; it does not establish quality, latency, or cost improvement.

No remaining blocker for Module 25.
