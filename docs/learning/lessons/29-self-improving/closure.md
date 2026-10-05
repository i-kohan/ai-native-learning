# Module 29 — Closure

**Status:** MASTER CLOSED on 2026-10-05.

## Final understanding check

Result: **PASS with precision corrections**.

The learner demonstrated the core Module 29 model:

- self-modifying means the system can change itself; self-improving requires external evidence that the change is better;
- candidate generation is distinct from evaluation and admission;
- improvement claims require a predefined objective and frozen decision rule;
- hypothesis-before-patch turns mutation into a testable causal claim;
- mutation budgets keep one experiment attributable and prevent rule-changing sprawl;
- hidden evaluation reduces Goodhart/reward-hacking pressure;
- authority can expand by deleting a guard, not only by adding a powerful API;
- `0/3 vs 0/3` means H1 failed the frozen adoption rule but does not establish a maintainability ranking;
- green regression tests can coexist with a useless candidate;
- hard safety/security gates are non-tradeable inside the experiment.

Precision corrections:

```text
Target     = current harness / H0 being changed
Optimizer  = Meta-Improver that proposes H1
Evaluator  = host-owned integrity, regressions, hidden maintenance grader
Admission  = host-owned deterministic accept/reject/inconclusive rule
```

The Meta-Improver is the Optimizer; it is not a fifth authority role.

The benchmark-hardcoding failure mode is Goodhart / reward hacking / evaluator gaming.

Automatic rejected-candidate feedback followed by H2, H3, ... would create a recursive self-improvement/search loop with new problems of evaluator overfitting, contamination, lineage, cost, parent selection, and cumulative authority. META01 intentionally stops after one candidate.

A hard gate cannot be compensated by soft metrics. If a condition is genuinely tradeable, it must be classified differently before the run.

## META01 result

### Episode A

Frozen parent:

`fa640a0bbeec2edb2177775e757c127fd9ec599b`

Baseline `tsc` failed.

Result:

`experiment_stopped_insufficient_regression_evidence`

No H1 verdict was made.

### Episode B

New explicitly frozen parent:

`afc1abdc0f8f528a3d45b2c1495fea35e74c6aa7`

The Meta-Improver produced a reasonable hypothesis about extracting optional Worker capability composition from `runAgentLoop()`.

The actual candidate created `loop-ext/worker-capabilities.ts` but did not connect it to `loop.ts`.

Existing regressions stayed green, demonstrating why regression preservation is necessary but insufficient for an improvement claim.

The hidden maintenance comparison was:

```text
H0: 0/3
H1: 0/3
```

The frozen decision rule therefore returned:

`candidate_rejected`

Supported claim:

> H1 did not satisfy the frozen adoption criterion.

Unsupported claim:

> H0 is proven more maintainable than H1.

The candidate was not merged, `main` did not move to H1, and no H2 was generated.

## Post-run methodology review

Review found a real integrity gap: candidate authority checking focused on added lines, while authority can expand through removal of an existing guard.

The control plane was hardened with:

```text
removed-line evidence
+ known authority-guard tracking
+ host-owned behavioral invariants
+ fail-closed handling when an affected invariant cannot be verified
```

This hardening was not retroactively attributed to the historical candidate run.

## Accepted known limitation

The behavioral authority suite does not exhaustively exercise the real admitted-MCP replacement path:

```text
normal:
  read_file available
  repo_read_file unavailable

MCP admitted:
  read_file unavailable
  repo_read_file available through admitted MCP
```

The current checks cover surrounding MCP/default invariants and fail closed on an unverified guard removal, but they do not independently prove that full admitted-MCP behavior after every possible refactor.

This remains documented rather than expanded into another META01 run because the module's goal is a bounded self-improvement control loop, not a production-grade exhaustive security verifier.

## Module decision

META01 successfully demonstrated the learning-critical architecture even though its candidate was rejected:

```text
externally defined problem
→ bounded optimizer
→ hypothesis
→ isolated candidate
→ external integrity/regression/hidden evaluation
→ external deterministic admission
→ human adoption boundary
```

The practical lesson is stronger than "AI can refactor itself":

> a plausible self-generated patch, even with green ordinary tests, is not an improvement until independent evidence satisfies a rule the candidate cannot change.

Current architecture decision:

- keep the normal harness unchanged;
- do not adopt the META01 candidate;
- do not generate H2;
- retain META01 as an opt-in learning/control-plane experiment;
- treat authority/evaluation/admission as host-owned;
- revisit recursive or multi-generation self-improvement only for a real future workload with explicit budgets, fresh evaluation strategy, lineage, and authority constraints.

Remaining Topic Chat blockers: **none**.

Module 29 is closed from the Topic Chat side. No Module 30 is introduced.


## Master acceptance

Master review accepts META01 as the correct final-module result.

Evidence supports:

```text
known-good parent frozen             = yes
candidate isolated from main         = yes
hypothesis recorded before mutation  = yes
mutation surface / patch budget      = bounded
eval / grader / admission authority  = outside candidate
H0 regression gate                   = PASS
H1 regression gate                   = PASS
hidden maintenance trials            = H0 0/3, H1 0/3
frozen structural adoption rule      = not satisfied
decision                              = candidate_rejected
candidate merged/adopted              = no
recursive H2 generation               = no
```

The rejection is interpreted narrowly: H1 failed the frozen adoption criterion. It does not prove H0 is globally more maintainable.

The post-run authority hardening is also accepted as a methodology improvement rather than retroactive evidence for H1. In particular, authority analysis now recognizes that deleting an existing guard can widen capability, and relevant behavioral invariants fail closed when the affected guard cannot be verified.

The documented admitted-MCP blind spot remains a bounded-probe limitation rather than a closure blocker.

Final Master decision:

```text
self-modification mechanism            = demonstrated
external evaluation/admission boundary = demonstrated
measured H1 improvement                = not demonstrated
candidate                              = rejected
normal harness                         = unchanged
recursive self-improvement             = not attempted
remaining Module 29 blockers           = none
```

Module 29 completes the planned 29-module learning roadmap. No Module 30 is implied.
