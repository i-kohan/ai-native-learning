# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering
4. ✅ 04 — Verification + bounded Repair
5. ✅ 05 — Independent Review + bounded Review Repair
6. ✅ 06 — Tracing & Evals

Current harness: **V3 Spec-Driven + targeted context + bounded verify/repair + independent review**, with a **systematic measurement layer** (`HarnessRunResult → RunMetrics → EvalResult`) around the unchanged V3 control flow.

Current execution flow:

```text
raw task
→ deterministic context preparation / repo orientation
→ read-only spec phase
→ SpecDecision
   ├─ needs_human_judgment → stop before coding side effects
   └─ executable
       → implementation episode
       → harness-owned VERIFY / bounded repair
          ├─ cannot reach PASS → stop
          └─ PASS
             → independent REVIEW #1
                ├─ no accepted blocker → success
                └─ accepted blocker
                   → one review repair
                   → deterministic VERIFY again
                   → REVIEW #2
                      ├─ pass → success
                      └─ accepted blocker → stop
```

Measurement layer:

```text
HarnessRunResult / raw traces
→ semantic normalization
→ RunMetrics
→ fixed-suite aggregation
→ EvalResult + report
→ engineering decision
```

Detailed evidence lives in `docs/learning/experiments.md` and `docs/learning/lessons/*`.

## Next module

**07 — Skills**

Why now:

- the current `master-learning-plan.md` places Skills immediately after Independent review/repair in Phase 2 — Reliable Autonomy;
- spec, context, verification and review boundaries now exist, so reusable procedures can have explicit inputs, context requirements and verification rather than becoming generic prompt snippets;
- Module 06 gives us a fixed measurement layer, so a skill can be evaluated rather than kept because it merely feels helpful;
- the goal is reusable procedural knowledge for repeated workflows, not a generic agent/plugin framework.

After Skills, follow the current master plan with **Worktrees / Isolation**, then **Security fundamentals**.

Target after Module 07: **V3 + measurement layer + small real Skills mechanism / several concrete reusable skills**, without changing the core agent roles or adding model routing/subagents.

---

## Module: 06 — Tracing & Evals

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-20.

Theory recap: `docs/learning/lessons/06-tracing-evals/theory.md`  
Practical notes + eval evidence: `docs/learning/lessons/06-tracing-evals/`

### Built

- normalization boundary: `HarnessRunResult → RunMetrics`;
- aggregation: `RunMetrics[] → EvalResult`;
- fixed-suite runner: T01–T04 + R01 + REV01;
- capability/regression tasks separated from controlled mechanism probes;
- outcome, recovery, autonomy, efficiency and reviewer/finding diagnostics kept semantically distinct;
- recurring finding aggregation;
- compact human-readable report + normalized JSON artifacts;
- deterministic semantic tests in `harness/tests/eval.test.ts`.

### Fixed-suite evidence

Fresh post-review run:

`docs/learning/lessons/06-tracing-evals/traces/2026-08-20T12-19-39-403Z.txt`

Recorded:

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed contracts         6 / 6
Hard regressions            none
```

### Semantic fixes verified before closure

1. **REV01 contract is strict**

```text
VERIFY PASS
→ review repair
→ VERIFY PASS
```

It requires exactly `PASS → PASS` and **zero verification repairs**. A bad review repair producing `PASS → FAIL → PASS` and then being rescued by the ordinary verification-repair loop does not count as successful independent-review probe.

2. **Recurring findings use `(findingKey, category)` identity**

The same textual key emitted as different semantic categories is retained as separate aggregation entries rather than silently merged.

Both semantics are covered by deterministic eval tests.

### Important conclusions

- trace answers **what happened in one run**; eval answers **how well the harness behaves across runs/tasks**;
- raw trace facts, normalized run semantics and benchmark judgment are separate levels;
- `expectedOutcomeMet` is the benchmark outcome metric and can be true for correct escalation;
- T04 first-pass/eventual/recovered are `null`, not false;
- R01/REV01 are controlled mechanism probes and do not belong in natural first-pass denominators;
- outcome metrics take priority over diagnostic efficiency metrics;
- accepted/rejected reviewer findings are policy outcomes, not generic true/false-positive ground truth;
- `escapedDefect = null` because the current benchmark grader is the same `npm test` as harness VERIFY and therefore is not independent ground truth;
- `failureLayer` remains unclassified when evidence does not justify a root-cause claim;
- recurring findings are human-review candidates for possible promotion into deterministic checks, never automatic rules.

### Known non-blocking limits

1. No independent hidden/benchmark grader yet, so escaped-defect detection remains N/A.
2. No repeated-trial / holdout / variance methodology yet; that belongs to Stronger Eval Methodology later in the roadmap.
3. Spec-phase wall time is not separately instrumented.
4. Per-tool census is intentionally partial.
5. No stored efficiency baseline / automatic efficiency regression threshold yet.
6. Reviewer precision/recall is not claimed without ground truth.

### Master closure

Module 06 satisfies the roadmap basic Tracing + Evals goal:

- existing V3 traces were reused rather than replaced with unnecessary observability infrastructure;
- a stable semantic normalization layer now makes cross-run comparison possible;
- the fixed suite distinguishes representative capability tasks from controlled probes;
- benchmark denominators and N/A states are explicit rather than misleading;
- the eval report reproduces known T01–T04, R01 and REV01 behavior and reports no hard regression;
- semantic bugs found during Topic Chat review were corrected, regression-tested and confirmed by a fresh full-suite run;
- limitations around independent ground truth and statistical confidence are explicit rather than silently overclaimed.

No additional tracing/eval platform work is required before moving on.

---

## Module: 05 — Independent Review + bounded Review Repair

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-19.

Key outcome:

- deterministic PASS is followed by a fresh artifact-focused reviewer;
- structured findings pass through harness-owned acceptance policy;
- one bounded review repair is allowed, followed by mandatory deterministic re-verification and final re-review;
- REV01 demonstrated a deterministic-green ARCH-01 violation being found and repaired before acceptance.

Theory: `docs/learning/lessons/05-independent-review/theory.md`.

---

## Module: 04 — Verification + bounded Repair

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-19.

Key outcome:

- external deterministic FAIL becomes normalized evidence → bounded repair → mandatory re-verification;
- R01 demonstrated FAIL → repair → PASS;
- harness, not model prose, owns completion.

Theory: `docs/learning/lessons/04-verification-repair/theory.md`.

---

## Module: 03 — Context Engineering

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-18.

Key outcome:

- targeted repo orientation + spec→implementation path reuse reduced blind discovery and tokens/wall time while preserving correctness and T04 escalation.

Theory: `docs/learning/lessons/03-context-engineering/theory.md`.

---

## Module: 02 — Spec-Driven Development

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-17.

Key outcome:

- raw intent passes through a physically read-only structured spec phase;
- `SpecDecision = executable | needs_human_judgment` gates coding side effects;
- T04 ambiguity stops before implementation.

Theory: `docs/learning/lessons/02-spec-driven-development/theory.md`.

---

## Module: 01 — Agent Loop & Harness

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-13.

Key outcome:

- explicit model → tool → observation loop, bounded capabilities, external verification and traces;
- V0 established the baseline and exposed ambiguity/completion failures.

Theory: `docs/learning/lessons/01-agent-loop-harness/theory.md`.
