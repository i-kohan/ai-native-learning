# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering
4. ✅ 04 — Verification + bounded Repair
5. ✅ 05 — Independent Review + bounded Review Repair
6. ✅ 06 — Tracing & Evals

Current harness: **V3 Spec-Driven + targeted context + bounded verify/repair + independent review**, with a **systematic measurement layer** and a **small Skills mechanism** (`evidence-guided-repair` loaded only for repair / review_repair episodes).

Current execution flow:

```text
raw task
→ deterministic context preparation / repo orientation
→ read-only spec phase
→ SpecDecision
   ├─ needs_human_judgment → stop before coding side effects
   └─ executable
       → implementation episode (no skill)
       → harness-owned VERIFY / bounded repair
          (repair episode loads evidence-guided-repair)
          ├─ cannot reach PASS → stop
          └─ PASS
             → independent REVIEW #1 (no repair skill)
                ├─ no accepted blocker → success
                └─ accepted blocker
                   → one review repair (loads evidence-guided-repair)
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

## Next

**07 — Skills** has completed Topic Chat implementation/evidence/theory review and is **ready for formal Master closure**. Master should verify the current repository state, close Module 07 if satisfied, and only then choose the next roadmap module from `master-learning-plan.md`.

---

## Module: 07 — Skills

**Status:** implementation + experiment + Topic Chat review complete — **ready for Master closure**.

Theory: `docs/learning/lessons/07-skills/theory.md`  
Practical notes + eval evidence: `docs/learning/lessons/07-skills/`

### Built

- one reusable skill: `skills/evidence-guided-repair/SKILL.md`;
- deterministic loader/selector: `skillIdForPhase` + `loadSkill(skillId)`;
- skill injected as a labeled procedural-context block, not merged into privileged role instructions;
- `REPAIR_INSTRUCTIONS` / `REVIEW_REPAIR_INSTRUCTIONS` kept role-specific;
- `skill_loaded` trace/result provenance (`skillId`, `phase`, `contentHash`);
- eval report Skills section; unexpected disclosure is a diagnostic, not a hard 6/6 failure.

### Fixed-suite evidence

`docs/learning/lessons/07-skills/traces/2026-08-21T11-14-29-911Z.txt`

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed contracts         6 / 6
Hard regressions            none
Skill disclosure diagnostics none
```

Progressive disclosure:

- T01–T04: no `skill_loaded`;
- R01: `evidence-guided-repair` loaded exactly for `repair`;
- REV01: loaded exactly for `review_repair`; reviewer episodes did not receive it;
- same SKILL.md hash on R01 and REV01: `efa5e14d5382c9108bd40dc471d62627bea07bb28b3676b4b523428d0dc29a25`.

### Important design decisions

- one skill, two roles: verification-repair and review-repair stay distinct episodes;
- skill is procedural guidance only; spec, repo state, tools, VERIFY, review policy and retry bounds stay authoritative;
- missing/invalid skill fails explicitly (`SkillLoadError`);
- no model-selected routing, registry, or extra skills;
- Module 07 success is judged as preserved fixed contracts **plus** correct progressive disclosure, not `6/6` alone.

### Topic Chat conclusions

- implementation accepted; no repair required;
- experiment supports modular reuse + selective loading + preservation of existing outcomes/authority boundaries;
- experiment does **not** claim that the Skill causally improves model quality, because R01/REV01 already passed before extraction;
- Skill is reusable procedural **HOW**, while Spec remains **WHAT**;
- role and skill are separate axes: two repair roles reuse one procedure;
- harness owns repair start, selection, retry/control flow and capabilities; Skill does not launch itself or expand authority;
- evidence is not automatically root cause or prescribed fix;
- repeating behavior should be classified before becoming a Skill: facts → context/docs, hard invariants → policy/checks, deterministic operations → software, reusable uncertain procedures → Skills;
- Skill discovery finds candidates; selection decides what actually loads;
- Skills should be re-evaluated and may be changed, automated or retired as models/environments evolve.

### Known limits

- only one skill exists; there is no catalog beyond a hardcoded phase map;
- skill loading is diagnostic rather than part of the 6/6 product/mechanism contracts, so closure also requires no disclosure diagnostics;
- no claim about multi-skill routing, automatic mining, organization-wide registry/governance, or model-quality uplift.

### Topic Chat recommendation

Module 07 satisfies the intended basic Skills learning goal and is ready for Master closure. No next module is selected here.

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
