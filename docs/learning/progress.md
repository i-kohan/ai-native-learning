# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering
4. ✅ 04 — Verification + bounded Repair
5. ✅ 05 — Independent Review + bounded Review Repair
6. ✅ 06 — Tracing & Evals
7. ✅ 07 — Skills

Current harness: **V3 Spec-Driven + targeted context + bounded verify/repair + independent review**, with:

- systematic measurement: `HarnessRunResult → RunMetrics → EvalResult`;
- one reusable procedural Skill: `evidence-guided-repair`;
- deterministic progressive disclosure: the Skill is loaded only for `repair` and `review_repair` episodes.

Current execution flow:

```text
raw task
→ deterministic context preparation / repo orientation
→ read-only spec phase
→ SpecDecision
   ├─ needs_human_judgment → stop before coding side effects
   └─ executable
       → implementation episode (no repair skill)
       → harness-owned VERIFY / bounded repair
          (repair loads evidence-guided-repair)
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

## Next module

**08 — Worktrees / Isolation**

Why now:

- the current `master-learning-plan.md` places **Worktrees / Isolation immediately after Skills** in Phase 2 — Reliable Autonomy;
- the harness can now execute, repair, review and measure work, but all tasks still conceptually operate against shared mutable workspace state;
- isolation is the next prerequisite for safely running autonomous or parallel task executions without cross-task filesystem/environment interference;
- security remains the following module: this module should establish workspace/environment isolation without prematurely expanding into the full untrusted-input / credential / network threat model.

Target after Module 08: **current V3 + measurement + Skills + a small per-task isolation/workspace boundary**, with evidence that task state does not leak or collide across isolated runs.

After Module 08, follow the current master plan with **09 — Security fundamentals**.

---

## Module: 07 — Skills

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-21.

Theory: `docs/learning/lessons/07-skills/theory.md`  
Practical notes + evidence: `docs/learning/lessons/07-skills/`

### Built

- `skills/evidence-guided-repair/SKILL.md` as reusable procedural **HOW**;
- deterministic `skillIdForPhase` + `loadSkill` mechanism;
- Skill injected as labeled procedural context rather than privileged role instructions;
- one Skill reused across verification repair and review repair while those roles remain separate;
- `skill_loaded` provenance with `skillId`, `phase`, and `contentHash`;
- eval diagnostics for unexpected Skill disclosure.

### Fresh fixed-suite evidence

`docs/learning/lessons/07-skills/traces/2026-08-21T11-14-29-911Z.txt`

```text
T01–T04 expected outcomes    4 / 4
Executable first-pass        3 / 3
Correct escalation T04       1 / 1
R01 verification repair      PASS
REV01 independent review     PASS
All fixed contracts          6 / 6
Hard regressions             none
Skill disclosure diagnostics none
```

Progressive disclosure:

- T01–T04: no Skill loaded;
- R01: `evidence-guided-repair@repair` only;
- REV01: `evidence-guided-repair@review_repair` only;
- R01 and REV01 used the same Skill content hash.

### Master closure

Module 07 satisfies the intended Skills goal:

- reusable procedure is separated from role, spec, context, tools and harness policy;
- Skill does not expand capabilities or lifecycle authority;
- the same procedural knowledge is reused across two distinct repair roles;
- selective loading is observable and verified, not inferred from final PASS alone;
- fixed-suite outcomes and mechanism contracts remain intact;
- no unnecessary registry, model-selected routing, plugin framework, or multi-skill infrastructure was added;
- the experiment correctly claims modular reuse/selective disclosure, not causal model-quality uplift.

No additional Skills infrastructure is required before moving on.

### Known non-blocking limits

1. Only one Skill exists; no general catalog/registry is justified yet.
2. Selection is deterministic by phase; model-selected routing belongs later.
3. Module 07 does not prove quality uplift because R01/REV01 already passed before Skill extraction.
4. Skills must be re-evaluated over time and may become deterministic software/checks or be retired.

---

## Prior completed modules — compact recap

- **06 — Tracing & Evals:** fixed suite, semantic normalization, capability/probe separation, regression reporting.
- **05 — Independent Review:** deterministic-green architecture defect can be caught by independent artifact-focused review and bounded repair.
- **04 — Verification + Repair:** external FAIL → factual evidence → bounded repair → mandatory re-verification.
- **03 — Context Engineering:** targeted orientation/reuse reduced blind discovery while preserving outcomes.
- **02 — Spec-Driven Development:** read-only structured spec + ambiguity gate before coding side effects.
- **01 — Agent Loop & Harness:** explicit model/tool/observation loop, bounded tools, external verification and traces.
