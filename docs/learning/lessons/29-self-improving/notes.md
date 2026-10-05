# 29 — META01 notes

Status: **Topic Chat closed on 2026-10-05**. META01 produced one rejected candidate. No adoption. `runV1Harness()` remains unchanged.

## Command

```text
npm run benchmark:meta01 --prefix harness
```

## Experiment episodes

Episode A parent: `fa640a0bbeec2edb2177775e757c127fd9ec599b`.

- Frozen baseline failed at `tsc`.
- Result: `experiment_stopped_insufficient_regression_evidence`.
- H1 was not scored.
- This is not a candidate rejection.

Episode B parent: `afc1abdc0f8f528a3d45b2c1495fea35e74c6aa7`.

- Type-only cleanup happened before the episode.
- The new parent was explicitly re-frozen.
- A fresh Meta-Improver candidate was generated.
- Thresholds/decision rule were not changed after observing the candidate.

## Frozen budgets

```text
Meta-Improver: 12 model turns
maintenance: 16 model turns per trial
candidate: 1
trials: H0 3 + H1 3
patch: <= 3 files, <= 300 additions+deletions
```

Writable candidate surface:

```text
harness/src/loop.ts
harness/src/loop-ext/<Name>.ts   # create-only, at most two
```

## Result

Episode B decision:

`candidate_rejected`

H0 and H1 passed the existing regression gate. The candidate revision was detached from `main`.

Candidate patch:

```text
+ harness/src/loop-ext/worker-capabilities.ts
loop.ts unchanged
```

The hypothesis proposed a real capability boundary, but the patch did not wire the new module into the loop.

Maintenance result:

```text
H0 external grader: 0/3
H1 external grader: 0/3
```

Therefore:

- H1 failed the frozen adoption rule;
- no maintainability ranking between H0 and H1 is supported;
- no candidate was adopted;
- no H2 was generated.

Historical record:

`docs/learning/lessons/29-self-improving/traces/meta01-2026-10-04T22-27-17-924Z.json`

## Post-run authority hardening

The first authority-integrity implementation mainly scanned added lines. Review found that authority can expand by deleting a guard.

The control plane was hardened to record removed lines and run host-owned behavioral invariants.

Admission now requires both:

```text
staticDiffPassed
behavioralInvariantsPassed
```

A guard may move if the effective behavior is still proven. A guard that disappears, widens behavior, or cannot be verified fails closed.

This hardening happened after the historical META01 candidate. The old CandidateRecord was not rewritten to claim checks that did not exist at the time.

## Known limitation — admitted MCP path

The authority suite does not exhaustively execute the real **MCP-admitted** read-path scenario.

Intended behavior:

```text
MCP not admitted:
  read_file available
  repo_read_file unavailable

MCP admitted:
  read_file not exposed
  repo_read_file available through the admitted MCP session
```

The hardening verifies important surrounding invariants and fail-closes on an unverified removal of the known direct-read guard. It does not independently prove the full admitted-MCP replacement behavior after every candidate refactor.

A syntactically relocated guard could therefore be stronger evidence than it ideally should be for that one invariant.

Accepted interpretation:

```text
bounded learning probe with a known verification blind spot
```

Not:

```text
production-grade proof of every capability boundary
```

No new candidate or rerun is justified for this limitation.

## Final understanding check

Result: **PASS with precision corrections** on 2026-10-05.

The learner correctly understood:

- self-modification does not imply improvement;
- improvement needs measurable external evidence;
- a concrete hypothesis makes a bounded mutation testable;
- mutation budgets improve attribution and prevent broad rule-changing patches;
- authority can expand by deleting a restriction;
- hidden evaluation reduces optimizer adaptation to the exact grader;
- `0/3 vs 0/3` rejects H1 under the frozen rule but does not rank maintainability;
- ordinary green regressions do not prove a structural improvement;
- self-improvement must preserve safety/architecture invariants.

Precision corrections retained:

1. In META01, **Meta-Improver is the Optimizer**. The Target is H0/the harness; Evaluator is host-owned integrity/regression/hidden grading; Admission is the host-owned deterministic decision rule.
2. The benchmark-hardcoding example is **Goodhart / reward hacking / evaluator gaming**.
3. Automatic H1 → H2 → H3 after feedback would be a recursive improvement/search loop, not the one-candidate META01 experiment.
4. A failed **hard** security gate means reject. If a policy is tradeable, it must be classified as a soft objective before the run rather than relaxed after seeing results.
5. Safe self-improvement does not mean the candidate "confirms itself"; evaluation, admission, and adoption authority remain outside the candidate.

See `theory.md` and `closure.md`.
