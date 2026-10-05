# 29 — Self-Modifying / Self-Improving Systems

## Core idea

A system is **self-modifying** when it can change code, configuration, prompts, policies, routing, or other parts of the system that affect later behavior.

That alone is not improvement.

```text
H0 → H1
```

only proves that H0 produced a different candidate.

A system is **self-improving** only when there is credible external evidence that H1 is better for a predefined objective while required invariants still hold.

```text
H0
→ candidate H1
→ external evaluation
→ external admission
→ accept / reject
```

The important word is **external**: the candidate must not be able to redefine what "better" means, alter the grader, relax the gate, or grant itself adoption authority.

## Three useful levels

These ideas are easy to conflate:

1. **Automated improvement of an external object.** An optimizer proposes variants of some program/algorithm and an evaluator selects better ones. AlphaEvolve is a useful mental model for this search/evaluation pattern.
2. **Self-modification.** The object being changed is the agent/harness itself: H0 proposes H1.
3. **Recursive self-improvement.** An accepted H1 becomes the next improver and can generate H2, then H3, and so on.

DGM and AIDE² are useful examples of the third family, but organize the search differently. AIDE² is easy to picture as an accepted lineage:

```text
H0 → H1 → H2 → H3
```

DGM is better pictured as an archive/tree where several descendants can coexist and a non-best branch may later produce a stronger descendant:

```text
        H0
      /    \
    H1      H2
   /  \      \
 H3    H4      H5
```

META01 deliberately does **not** implement recursive self-improvement. It performs one bounded H0 → H1 cycle and stops.

## Four roles: Target, Optimizer, Evaluator, Admission

A safe improvement loop separates four responsibilities.

### Target

The thing being changed.

In META01:

```text
Target = the current harness, especially optional-capability coupling in loop.ts
```

### Optimizer

The component that proposes a candidate change.

In META01:

```text
Optimizer = bounded Meta-Improver
```

"Improver" and "Optimizer" are the same role here.

### Evaluator

Produces evidence about the candidate.

In META01 this includes host-owned integrity/regression checks and the hidden maintenance grader.

The evaluator answers questions such as:

```text
Did existing behavior regress?
Did authority change?
Can the fresh maintenance task be implemented correctly?
Did core-loop coupling actually decrease?
```

### Admission

Turns evaluation evidence into a workflow consequence using a rule frozen before the outcome.

In META01:

```text
Evaluator → evidence
Admission → candidate_rejected /
            candidate_promising_but_inconclusive /
            candidate_accepted_for_this_workload
```

The Optimizer must not own Evaluator or Admission. Otherwise it can improve its score by changing the rules instead of improving the target.

## External objective and Goodhart's law

A metric becomes dangerous when the optimizer can target the metric rather than the underlying property.

Example:

```text
H0 benchmark success = 70%
H1 benchmark success = 100%
```

That looks like improvement until we discover that H1 recognizes the benchmark task IDs and hardcodes their answers.

The score improved. The capability did not.

This is the Goodhart / reward-hacking / evaluator-gaming problem:

> when a proxy becomes the optimization target, the optimizer can learn to improve the proxy instead of the thing the proxy was meant to represent.

That is why benchmark tasks, graders, thresholds, security policy, candidate admission, and the mutation allowlist stay outside candidate authority.

## DEV, hidden evaluation, and contamination

The optimizer needs some evidence to know what problem it is trying to solve. That evidence is development signal.

But strong evaluation needs information that was not used to generate the candidate.

```text
DEV evidence
→ diagnose / design H1

hidden GATE / HOLDOUT
→ evaluate H1
```

If the optimizer sees a hidden task's result and uses it to generate the next patch, that task has become development signal. It should no longer be treated as fresh evidence for the same claim.

META01 follows the same principle with a hidden maintenance task. The Meta-Improver knows the class of problem — optional Worker capability coupling — but does not see the concrete capability task or grader before H1 is frozen.

## Hard gates vs soft objectives

Some properties may be traded against each other:

```text
latency
tokens
cost
tool calls
diff size
```

These are soft objectives.

Other properties are declared non-negotiable before the run:

```text
security boundary
no authority expansion
benchmark/grader integrity
provenance
regression floor
mutation boundary
```

These are hard gates.

A hard gate is not a weighted metric.

```text
quality +20
security -10
----------------
accept +10
```

is invalid if security was declared a hard gate.

If a security condition is genuinely tradeable, it must not be classified as a hard gate. That policy decision must be made before observing the candidate outcome, not relaxed afterward because a candidate looks attractive.

## Why hypothesis-before-patch matters

Before mutation, the optimizer records:

```ts
type ImprovementHypothesis = {
  observedProblem: string;
  suspectedCause: string;
  proposedMutation: string;
  expectedBenefit: string;
  expectedRisks: string[];
};
```

This gives the experiment a causal claim.

Without it:

```text
"make the harness better"
→ many unrelated changes
→ score changes
→ unclear why
```

With it:

```text
observed problem
→ suspected mechanism
→ bounded mutation
→ predicted effect
→ evaluate that effect
```

The hypothesis is evidence and intent, not authority. A convincing hypothesis does not admit a patch.

## Mutation budget and one-layer changes

META01 allows only a small mutation surface because a huge candidate is difficult to attribute and difficult to evaluate.

The experiment froze:

```text
one candidate
one parent revision
loop.ts
+ at most two create-only helper files
<= 300 additions + deletions
```

This keeps the experiment interpretable and prevents the optimizer from "winning" by changing the target, evaluator, security policy, retry policy, benchmark, and admission rule together.

A bounded experiment may reject a change simply because it requires a larger mutation than allowed. That is a valid result; the budget must not be expanded after seeing the candidate.

## Authority is about effective behavior, not suspicious new lines

A critical review finding in META01 was that the original integrity scanner looked mainly at added lines.

But authority can expand by **deleting** a restriction.

Example:

```diff
- if (remainingDelegations <= 0) {
-   return deny();
- }
```

No dangerous new API was added, but the effective capability changed from bounded delegation to potentially unbounded delegation.

Therefore the hardened control plane uses two layers:

```text
static diff evidence
+ behavioral authority invariants
```

A guard may legitimately move during refactoring. Moving it is allowed only when the host can still verify the effective invariant.

```text
guard moved + behavior preserved → allowed
guard disappeared + behavior widened → reject
guard changed + relevant behavior cannot be verified → fail closed
```

## MCP example and the documented limitation

"MCP admitted" means that the Host has approved the MCP repository-read capability for this particular episode.

The intended behavior is roughly:

```text
normal implementation episode:
  read_file          available
  repo_read_file     unavailable

MCP-admitted implementation episode:
  read_file          not exposed
  repo_read_file     available through the admitted MCP session
```

Why replace the direct path? Because Module 23 intentionally made MCP repository read a bounded alternative capability, not an extra unrestricted read path.

The post-run authority hardening verifies several MCP-related properties, including that `repo_read_file` is not usable without an admitted MCP session.

However, it does **not** exhaustively execute the complementary real admitted-MCP scenario and prove that direct `read_file` is unavailable there.

That leaves a narrow blind spot. A future candidate could theoretically relocate the known "read_file is not exposed" guard text in a way that looks like a refactor while changing the real admitted-MCP behavior. The static check has evidence that the guard moved, but this exact admitted-session behavior is not independently exercised by the META01 authority suite.

This is accepted as a **documented limitation** of the learning probe, not as proof of a production-grade security verifier. It does not affect the historical H1 result, and it does not justify generating H2 or rerunning META01.

## Non-monotonic improvement and lineage

Improvement is not monotonic.

```text
H1 better than H0
```

does not imply:

```text
H2 better than H1
```

Each mutation is another hypothesis.

That is why a self-improvement system needs a known-good checkpoint and candidate lineage:

```text
parent revision
candidate revision
hypothesis
patch hash
evaluation evidence
decision
```

A rejected candidate must not destroy the known-good parent.

In META01, an uncommitted patch would disappear when later evaluation created fresh Git worktrees. The Host therefore materializes H1 as a detached immutable `candidateRevision` without moving `main`.

## Why META01 stops after one candidate

Automatically doing:

```text
H1 rejected
→ feedback goes back to optimizer
→ generate H2
→ evaluate
→ generate H3
→ ...
```

would be a different experiment: a recursive search/self-improvement loop.

It introduces additional questions:

- how many generations are allowed?
- which candidate becomes the parent?
- can rejected branches remain in an archive?
- when does evaluation feedback become DEV contamination?
- how are cumulative cost and authority bounded?
- how do we prevent repeated optimization against one evaluator?

META01 intentionally answers a smaller question: can we safely automate one candidate-generation/evaluation cycle while keeping authority external?

One candidate is enough to learn that architecture.

## Online adaptation is not automatically self-modification

Not every system that changes behavior over time is self-modifying.

Temporary conversation state, retrieved memory, or choosing a different tool/model can change behavior without modifying the harness itself.

Likewise, self-improvement does not imply autonomous deployment.

```text
candidate passes evaluation
≠
candidate may merge itself
```

Human adoption remains a separate authority boundary.

## META01 practical design

The bounded experiment was:

```text
real structural debt
→ Meta-Improver
→ ImprovementHypothesis
→ isolated H1
→ integrity / authority gate
→ detached candidateRevision
→ H0/H1 regression
→ hidden maintenance task, 3 trials per arm
→ deterministic host decision
→ human adoption boundary
```

Target problem:

> `runAgentLoop()` accumulated feature-specific coupling for optional Worker capabilities such as Subagent, MCP and A2A behavior.

Frozen claim:

> at most, evidence of improved extensibility for this bounded class of optional Worker capability changes.

Not claimed:

- globally better architecture;
- general self-improvement;
- recursive self-improvement;
- autonomous deployment.

## What happened

### Episode A

Frozen H0:

`fa640a0bbeec2edb2177775e757c127fd9ec599b`

The parent itself failed the frozen `tsc` baseline qualification.

Result:

`experiment_stopped_insufficient_regression_evidence`

This is not a candidate failure. The experiment could not establish a clean baseline.

### Episode B

A type-only cleanup was made first, then a new H0 was explicitly re-frozen:

`afc1abdc0f8f528a3d45b2c1495fea35e74c6aa7`

A fresh Meta-Improver generated one candidate.

Its hypothesis was sensible: move optional capability composition/dispatch behind a dedicated boundary.

But the actual patch only created:

```text
harness/src/loop-ext/worker-capabilities.ts
```

and did not wire that module into `loop.ts`.

The candidate therefore looked plausible as code while not implementing its own proposed architectural change.

Existing regressions stayed green, which is exactly why "tests pass" cannot be the definition of improvement.

The hidden maintenance grader then produced:

```text
H0: 0/3
H1: 0/3
```

The frozen rule rejected H1.

Correct interpretation:

```text
H1 failed the frozen adoption criterion.
```

Incorrect interpretation:

```text
H0 is proven more maintainable than H1.
```

Because neither arm successfully implemented the maintenance task, the experiment did not produce positive comparative evidence about maintainability.

## What META01 actually demonstrated

The strongest result is about the **control architecture**, not about the candidate:

- candidate generation can be automated;
- hypothesis-before-write can be enforced;
- mutation authority can be bounded;
- the candidate can be isolated from its evaluator;
- a candidate revision can be preserved without moving the known-good branch;
- existing regressions and hidden evaluation can remain external;
- the candidate cannot grant itself acceptance;
- a plausible but useless self-patch can be rejected even when ordinary regression tests stay green;
- authority verification must consider deleted/relocated guards, not only new suspicious code.

The historical candidate remains rejected and was never adopted.

## Final mental model

A safe self-improvement loop is not:

```text
model edits itself
→ model says it is better
→ deploy
```

It is:

```text
externally defined objective + invariants
→ bounded optimizer proposes candidate
→ isolated immutable candidate
→ independent evaluation
→ deterministic external admission
→ human adoption
```

The model owns a candidate attempt.

The outer system owns **authority, evidence, and workflow consequence**.
