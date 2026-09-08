# 15 — Stronger Eval Methodology

## Mental model

A single green run is not a qualification claim. Eval methodology asks whether the **evidence** can support a **predefined, workload-bounded claim**.

```text
DEV / known workload     = used to build, debug, or tune the harness
HOLDOUT                  = frozen representative work, unused for tuning
VERIFY                   = harness-owned gate the Worker can see and satisfy
independent eval grader  = benchmark-owned ground truth after the run ends
```

T01–T04, P01, and P02 are known/dev. H01/H02 start as fresh holdout. R01/REV01 remain mechanism probes; ISO01/SEC01 stay separate.

### Holdout lifecycle

```text
fresh holdout
→ evaluate
→ if the result is used to change/tune the evaluated harness/mechanism
→ that task becomes DEV/known for future qualification
```

Holdout is therefore a lifecycle state, not a permanent label.

`unseen workload` in this module means unseen by **our development/eval process**. It does not claim that the foundation model never saw a similar pattern during pretraining.

---

## VERIFY vs independent grader

```text
isolated workspace from frozen baseRevision
→ prepare fixture (no hidden grader in target-app)
→ normal Spec / Worker / VERIFY / repair / REVIEW
→ terminal outcome
→ host-owned independent grader against the final workspace
→ cleanup
```

`VERIFY` is part of the agent workflow: a failure can trigger repair. The independent grader runs only after the workflow has finished and does not help the Worker recover.

```text
VERIFY PASS + independent grader FAIL
→ escapedDefect = true
```

Without independent ground truth, escaped-defect absence must stay `null` / N/A; it cannot be inferred from VERIFY or REVIEW PASS.

Hidden grader tests may hide **cases**, not **requirements**. The task text must already contain the user-visible contract.

An independent grader is still only as strong as the behavior it actually checks. Passing it is evidence for the encoded contract, not a formal proof that every possible edge case is correct.

---

## Repeated trials and 3/3

H01 and H02 run 3 independent trials from the same frozen base, not from the previous trial's output.

```text
3/3 = three observed successful trials
3/3 ≠ 100% reliability
```

A predefined `3/3` criterion that produces `2/3` is simply not satisfied. Small `n` limits how broadly we can generalize; it does not turn a failed frozen criterion into `inconclusive`.

Boolean outcomes stay as counts. Repeated numeric metrics such as wall time, model/tool calls, and tokens use **median + range (min–max)** while retaining raw per-trial evidence.

Example:

```text
48s, 51s, 110s
median = 51s
range  = 48–110s
```

The range exposes variance that a mean alone can hide.

---

## Claims, metrics, and verdicts

The reasoning chain is:

```text
trace fact
→ normalized run metric
→ task judgment
→ suite evidence
→ engineering decision
```

A metric is not itself `supported` or `inconclusive`. Those words describe the **engineering claim** after applying a predefined decision rule.

| Verdict | Meaning |
| --- | --- |
| `supported` | predefined criteria hold on the tested frozen workload |
| `unsupported` | a predefined criterion failed |
| `regression` | a known contract broke or a defect escaped VERIFY |
| `inconclusive` | the evidence itself cannot support a clean decision |
| `candidate` | promising enough for further evaluation, not adopted/default yet |

Typical `inconclusive` causes: invalid trials, flaky grader, contamination, mixed/uncontrolled base/model provenance, or an uncovered trade-off.

Post-hoc thresholds are invalid methodology. If latency/cost criteria were not defined before seeing the results, do not invent a threshold afterwards to declare a winner.

---

## Module 15 qualification rule

Claim:

> Current default harness preserves known regression contracts and correctly completes the two frozen holdout workloads under the Module 15 qualification protocol.

Executable qualification now requires all of the following:

- T01–T04 have no regression;
- H01 **full expected outcome** = 3/3;
- H01 independent grader = 3/3 PASS;
- H02 **full expected outcome** = 3/3;
- H02 independent grader = 3/3 PASS;
- escaped defects = 0;
- grader calibration is valid;
- every qualification run has the same frozen `baseRevision` and configured model identity.

“Full expected outcome” means the workflow itself completed correctly, not merely that an external grader happened to pass. For H01/H02 it includes executable spec, implementation, successful workflow/final VERIFY, and independent grader PASS.

This closes an important evaluator gap:

```text
grader PASS
+ workflow failure
≠ supported qualification
```

Likewise, provenance is part of evidence validity:

```text
trial 1 @ SHA A
trial 2 @ SHA A
trial 3 @ SHA B
→ inconclusive / invalid qualification evidence
```

The qualification runner resolves the exact base revision and configured model once before the protocol, pins them for all workspaces/runs, and the decision layer independently rejects mixed/missing provenance.

### Recorded 2026-09-07 qualification

The historical artifact is intentionally unchanged:

```text
T01–T04   4/4 expected
H01       3/3 full expected outcome + 3/3 independent grader PASS
H02       3/3 full expected outcome + 3/3 independent grader PASS
escaped   0/6
calibration valid
base      a6b8e50012980cb79df820c1555c1211a1d76c94 for every recorded run
model     gpt-5.6-luna for every recorded run
verdict   supported
```

The post-qualification hardening does not change that historical verdict because the recorded evidence already satisfies the stronger rule. No H01/H02 rerun is needed merely to harden the evaluator.

---

## Drift

**Model drift:** record the configured model identity for every qualification. A different configured model makes qualification evidence invalid/inconclusive rather than silently mixing runs.

For the current harness this is configuration provenance, not a cryptographically pinned provider snapshot. Backend changes hidden behind the same provider/model alias may still be undetectable.

**Task-distribution drift:** as failures become known and are used for fixes, those tasks move toward DEV/regression. A healthy eval program must replenish fresh capability/holdout work instead of endlessly tuning on the same suite.

---

## Capability suite vs regression suite

A **capability suite** asks:

> What kinds of work can the system currently do, and how strong is it on representative harder work?

Examples: multi-file feature work, cross-layer changes, migration-like tasks, interacting requirements, or tasks designed to measure progress.

A **regression suite** asks:

> Did something we already knew how to do stop working after a change?

The same task can move from capability exploration into DEV/regression after it becomes known and repeatedly used for tuning.

---

## Static analysis

**Static analysis** checks code without executing the target behavior.

Examples:

```text
TypeScript typecheck
lint rules
forbidden imports / architecture boundaries
security scanners
AST-based policy checks
dependency rules
```

It complements runtime tests rather than replacing them. A production grader stack can therefore combine:

```text
unit/integration/e2e tests
+ static analysis
+ security/policy checks
+ calibrated model/human grading for subjective qualities
```

Each catches a different class of defect.

---

## What a mature production eval system can look like

Our Module 15 is the small version of a much larger production pattern:

```text
real product requirements + production failures
→ versioned task bank
   ├─ regression suite: things that must stay working
   ├─ capability suite: harder work used to measure progress
   └─ fresh holdout/canary slice: not used for tuning
→ isolated reproducible environments
→ multiple trials for stochastic tasks
→ outcome graders
   ├─ deterministic tests / state checks
   ├─ static analysis / policy checks
   └─ calibrated model/human graders where quality is subjective
→ traces + outcome + cost/latency + model/harness versions
→ predefined release gate
→ production monitoring / A-B tests / sampled human review
→ real failures become new DEV/regression cases
```

For coding agents, a mature grader often mirrors the SWE-bench pattern: the agent sees the issue and repository but not the evaluation tests; `FAIL_TO_PASS` tests check that the requested bug/feature was solved and `PASS_TO_PASS` tests check that unrelated behavior did not regress. Reproducible containers reduce environment noise.

Real production teams usually need more than one eval suite. Anthropic describes separate **capability/quality** and **regression** evals, multiple grader types, transcript review, and production monitoring/A-B testing as complementary layers. Their examples include Descript maintaining separate quality and regression suites, and Bolt combining static analysis, browser-based checks, and LLM judges.

The important production idea is not “one giant benchmark”. It is a maintained evidence system where each layer answers a different question and failures continuously improve the DEV/regression suite.

References:

- Anthropic, “Demystifying evals for AI agents” (2026-01-09): https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- SWE-bench Verified: https://www.swebench.com/verified.html
- OpenAI, “Introducing SWE-bench Verified”: https://openai.com/index/introducing-swe-bench-verified/

---

## Limits of our current implementation

Module 15 intentionally stops well before a production eval platform.

1. H01/H02 are only two tasks and both are from the same small task-app / CRUD family; they do not represent broad software engineering.
2. The independent grader boundary is credible, not a security fortress.
3. The normalized result preserves grader provenance and PASS/FAIL, but not the full independent-grader stdout as first-class trial evidence; that would be useful when diagnosing a future grader failure.
4. Configured model identity is pinned and checked within a qualification, but provider-side backend drift behind the same alias is not fully detectable.
5. Graders are tests, not formal specifications; coverage itself needs review and calibration.

---

## Takeaways

1. Holdout is a lifecycle, not a permanent label.
2. VERIFY is workflow control; independent grading is evaluation ground truth.
3. `escapedDefect` is only meaningful when a second, independent truth exists.
4. `3/3` is observed evidence, not 100% reliability.
5. Freeze decision rules before looking at results.
6. A qualification claim must gate on the **full workflow outcome**, not only one grader metric.
7. Reproducible evidence requires frozen base/model provenance as well as frozen tasks/graders.
8. Keep DEV, HOLDOUT, probes, and production signals in separate denominators.
9. Every conclusion must stay bounded to the tested tasks, harness, model/configuration, and grader quality.
