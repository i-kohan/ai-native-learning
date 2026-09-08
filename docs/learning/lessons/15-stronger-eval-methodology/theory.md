# 15 — Stronger Eval Methodology

## Mental model

A single green run is not a qualification claim. Eval methodology asks whether the **evidence** can support a **predefined** workload-bounded claim.

```text
DEV / known workload     = used to build, debug, or tune the harness
HOLDOUT                  = frozen representative work, unused for tuning
VERIFY                   = harness-owned gate the Worker can see and satisfy
independent eval grader  = benchmark-owned ground truth after the run ends
```

**DEV vs HOLDOUT (dev / holdout):** T01–T04, P01, and P02 are known/dev. H01/H02 start as fresh holdout. R01/REV01 remain mechanism probes; ISO01/SEC01 stay separate.

**Holdout contamination (заражение holdout):**

```text
fresh holdout
→ evaluate
→ if the result is used to change/tune the evaluated harness/mechanism
→ that task becomes DEV/known for future qualification
```

Do not silently keep calling it holdout after it has steered the mechanism.

## Mechanism / flow

```text
isolated workspace from frozen baseRevision
→ prepare fixture (no hidden grader in target-app)
→ normal Spec / Worker / VERIFY / repair / REVIEW
→ terminal outcome
→ host-owned independent grader against the final workspace
→ then cleanup
```

`VERIFY PASS + independent grader FAIL → escapedDefect = true`.

Absence of escaped defects is `false` only with independent ground truth. Without it, `escapedDefect = null` (N/A), never inferred from VERIFY/REVIEW PASS.

Hidden grader tests may hide **cases**, not **requirements**. The task text already states the user-visible contract.

## Repeated trials and 3/3

H01 and H02 run 3 independent trials from the same frozen base, not from the previous trial's output.

```text
3/3 = observed count
3/3 ≠ 100% reliability
2/3 ≠ inconclusive
```

Boolean outcomes stay as counts. Repeated numeric metrics (wall time, model/tool calls, tokens) report **median** and **range (min–max)** and keep raw per-trial evidence.

## Predefined decision rules

The Module 15 claim is supported only if:

- T01–T04 have no regression;
- H01 independent grader = 3/3 PASS;
- H02 independent grader = 3/3 PASS;
- escaped defects = 0;
- grader calibration is valid.

Verdict vocabulary:

| Verdict | Meaning |
| --- | --- |
| `supported` | predefined criteria all hold on this frozen workload |
| `unsupported` | a predefined criterion failed (e.g. holdout 2/3) |
| `regression` | known contract broke or an escaped defect appeared |
| `inconclusive` | evidence cannot support a clean decision |
| `candidate` | reserved for later adoption comparisons; not this claim |

`inconclusive` is for invalid trials, flaky grader, contamination, uncontrolled environment/model change, or an uncovered trade-off — not for “n is small”.

## Drift

**Model snapshot drift:** a different configured model than the one the claim assumed. Requalify; do not reuse old 3/3.

**Task-distribution drift:** adding/tuning against the same tasks moves them toward DEV. A holdout that steered a fix is no longer holdout.

## Practical observations

1. Catalog roles (`dev` / `holdout` / `probe`) keep denominators honest; one overall success percentage would hide that.
2. Calibration (PASS known-correct, FAIL known-defective, stable rerun) is cheap deterministic evidence and must precede trusting holdout outcomes.
3. `escapedDefect` becomes a real metric only after the independent grader exists; T01–T04 remain N/A because their grader is VERIFY.
4. The first frozen protocol was supported (T01–T04 4/4, H01 3/3, H02 3/3, escaped 0, calibration valid) and still does not mean 100% reliability.

## Takeaways

1. Holdout is a lifecycle, not a permanent label.
2. VERIFY is not eval ground truth when the Worker can see the same tests.
3. Report counts, median/range, and raw trials — not invented percentages.
4. Freeze the decision rule before looking at qualification outcomes.
5. Failed criteria stay failed; small n does not make them inconclusive.
6. Every claim stays workload-bounded to the frozen tasks and model snapshot.
