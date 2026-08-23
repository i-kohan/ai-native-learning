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
- deterministic progressive disclosure: the Skill is loaded only for `repair` and `review_repair` episodes;
- per-run Git worktree isolation for benchmark/eval execution (`Workspace` → bound `HarnessConfig`).

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

**08 — Worktrees / Isolation** is implemented and has isolation + regression evidence. Formal closure still pending Topic Chat review.

After Module 08, follow the current master plan with **09 — Security fundamentals**.

---

## Module: 08 — Worktrees / Isolation

**Status:** implemented + evidence recorded; **not formally closed**.

Theory: `docs/learning/lessons/08-worktrees-isolation/theory.md`  
Practical notes + evidence: `docs/learning/lessons/08-worktrees-isolation/`

### Built

- `Workspace` with explicit id, worktree root, exact base SHA, and ref;
- `createWorkspace` / `cleanupWorkspace` / `bindConfig` as the isolation boundary;
- benchmark/eval runs prepare fixtures inside the task workspace, not the shared main `target-app/src`;
- traces/evals stay on the host checkout;
- skills and benchmark inputs are read from the workspace revision;
- ISO01 mechanism probe: two worktrees from one SHA, mutate A only, verifier A FAIL / B PASS, main checkout unchanged, cleanup retry-safe.

### Fresh evidence

`docs/learning/lessons/08-worktrees-isolation/traces/2026-08-23T11-09-29-281Z.txt`

```text
Isolation
ISO01  A and B from e5d77788…; A mutated; B and main untouched
       verifier A FAIL / verifier B PASS
       cleanup explicit + retry-safe

Capability / Regression
T01–T04 expected outcomes    4 / 4
Executable first-pass        3 / 3
Correct escalation T04       1 / 1
R01 verification repair      PASS
REV01 independent review     PASS
All fixed V3 contracts       6 / 6
Hard regressions             none
```

ISO01 is a mechanism probe and is **not** in capability first-pass / task-success denominators.

### Known non-blocking limits

1. Isolation is Git-worktree / filesystem only. No sandbox, network, secret, or container boundary.
2. `target-app/node_modules` is shared via symlink; dependency install is not isolated.
3. Manual `npm start` still uses the main checkout; isolated execution is the benchmark/eval path.
4. Worktrees are created from the committed SHA, so uncommitted host edits are not part of the task workspace.

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
