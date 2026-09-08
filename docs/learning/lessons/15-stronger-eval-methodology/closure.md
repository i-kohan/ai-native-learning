# Module 15 — Stronger Eval Methodology — Closure

**Status:** ✅ COMPLETED in Topic Chat on 2026-09-08; subsequently hardened after Master review before Master-side closure.

## Final decision

```text
eval methodology     = implemented, reviewed, and hardened
qualification claim  = supported on frozen Module 15 workload
H01/H02              = fresh holdout for the recorded qualification evidence
historical artifact  = preserved unchanged
normal default       = unchanged
next step            = Master / planned Phase-3 consolidation
```

## Evidence reviewed

- T01–T04: 4/4 expected outcomes; T01–T03 first-pass PASS; T04 correct escalation.
- H01: full expected outcome 3/3; independent grader 3/3 PASS.
- H02: full expected outcome 3/3; independent grader 3/3 PASS.
- Escaped defects: 0/6.
- Grader calibration: valid on known-correct and known-defective implementations.
- Invalid trials: 0.
- Contamination: none for the recorded qualification.
- Recorded base revision: one SHA across the qualification artifact.
- Recorded configured model: one model identity across the qualification artifact.

Primary evidence:

`docs/learning/lessons/15-stronger-eval-methodology/traces/2026-09-07T17-26-05-593Z.txt`

## Independent-grader boundary

Confirmed:

- holdout grader tests are host-owned and absent from normal VERIFY;
- Worker filesystem tools are bounded to `target-app/`, with source writes under `target-app/src/`;
- independent grading runs after the harness terminal outcome and before workspace cleanup;
- grading is performed against a temporary staging copy of the final workspace;
- H01/H02 hidden tests check explicit requirements, not hidden product requirements;
- DEV, HOLDOUT, probes, isolation/security remain separate evidence categories.

## Master review hardening

Master found two methodology gaps in the evaluator implementation. Neither invalidated the recorded 2026-09-07 evidence, but both were fixed before Master-side closure.

### 1. Full holdout outcome is now part of the executable rule

Before the fix, the runner computed full `expectedOutcomeMet`, but the final qualification decision primarily gated on independent grader 3/3, escaped defects, known regressions, and calibration.

The decision layer now separately requires:

```text
H01 full expected outcome 3/3
H01 independent grader    3/3
H02 full expected outcome 3/3
H02 independent grader    3/3
```

A grader PASS cannot compensate for workflow failure.

Regression coverage explicitly checks:

```text
grader 3/3 + one workflow failure
→ qualification unsupported
```

### 2. Frozen provenance is now enforced

Qualification now resolves one exact base revision and one configured model before any trial, pins both for the whole sequential protocol, records run provenance, and independently validates it in the decision layer.

Mixed or missing provenance produces `inconclusive` evidence rather than silently using the first observed value.

Regression coverage explicitly checks:

```text
mixed baseRevision → inconclusive
mixed configured model → inconclusive
```

This is defense in depth: execution tries to preserve one provenance; evaluation refuses evidence when provenance differs.

### 3. Qualification reporting denominator clarified

`--qualify` now reports `DEV capability contracts 4/4` rather than `All fixed benchmark contracts 4/4`, because R01/REV01 are not run in that protocol.

## Historical result remains valid

No H01/H02 rerun was required solely for evaluator/provenance hardening.

The recorded qualification already had:

```text
T01–T04 expected 4/4
H01 expected      3/3
H01 grader        3/3
H02 expected      3/3
H02 grader        3/3
escaped           0/6
calibration       valid
one base SHA
one configured model
```

Therefore the workload-bounded historical verdict remains `supported`. The recorded trace/artifact is intentionally not rewritten post hoc.

## Remaining limitations

- only two holdout tasks, both from the same small task-app/CRUD family;
- configured model identity is pinned within the qualification, but provider-side backend drift behind the same alias is not fully detectable;
- full independent-grader stdout is not retained as first-class normalized trial evidence;
- grader boundary is credible evaluation isolation, not a hostile sandbox;
- graders are tests, not formal proofs, so coverage still needs review/calibration.

## Holdout lifecycle

H01/H02 remain fresh holdout for this recorded evidence because their results were not used to tune the harness. If either result later steers a harness/mechanism fix, that task becomes DEV/known for future qualification and new fresh holdout work is required.

Do not start Module 16 from this Topic Chat. Master owns the next step.
