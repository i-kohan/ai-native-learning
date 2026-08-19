# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering
4. ✅ 04 — Verification + bounded Repair

Current harness: **V3 Spec-Driven + targeted context + bounded verify/repair + independent review**.

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
          ├─ cannot reach PASS → stop (reviewer never starts)
          └─ PASS
             → independent REVIEW #1 (clean context)
                ├─ no accepted blocker → success
                └─ accepted blocker
                   → one review repair (source only)
                   → VERIFY again
                   → REVIEW #2 (no second repair)
```

Detailed evidence lives in `docs/learning/experiments.md` and the corresponding `docs/learning/lessons/*` folders.

## Next step

**Module 05 — Independent Review → Repair is complete at Topic Chat level and ready for formal Master closure.**

Master should read the latest `progress.md`, `experiments.md`, Module 05 `theory.md` / `notes.md`, and REV01 evidence, formally close Module 05 if it agrees, then choose the next module from `master-learning-plan.md`.

Topic Chat does not choose the next module automatically.

---

## Module: 05 — Independent Review + bounded Review Repair

**Status:** 🟡 READY FOR MASTER CLOSURE — Topic Chat review completed on 2026-08-19.

Theory recap: `docs/learning/lessons/05-independent-review/theory.md`  
Practical notes + traces: `docs/learning/lessons/05-independent-review/`

### Built

- independent reviewer after deterministic VERIFY PASS only;
- fresh model invocation with purpose-built ReviewContext (resolved spec, current diff, architecture constraints, compact verify evidence);
- structured `ReviewResult` / `Finding`; harness-owned acceptance (blocking / non-blocking / rejected);
- max automatic review repair = 1; REVIEW #2 cannot trigger repair #2;
- after review repair, existing V2 deterministic verify/repair is mandatory before re-review;
- REV01 controlled ARCH-01 injection (benchmark-only; observable tests stay green);
- deterministic tests for parse/policy/boundaries and REV01 result shape.

### Important design decisions

- reviewer does not receive implementer conversation, reasoning, or justification;
- deterministic verification is authoritative only for the checks it actually encodes;
- reviewer findings must not merely contradict passed deterministic evidence without new evidence;
- reviewer may still identify uncovered correctness problems when concrete, in-scope, actionable, and sufficiently high-confidence/severity;
- architecture/layering issues must not be restated as correctness/spec violations;
- reviewer reports WHAT/WHERE/WHY + related authority, not a prescribed fix;
- harness owns whether a finding is blocking and whether repair/reverify/rereview/stop occurs;
- no reviewer OFF/ON baseline; REV01 is a controlled mechanism probe like R01;
- no generic multi-agent framework, finding embeddings, or eval aggregation platform.

### REV01 evidence

Evidence: `docs/learning/lessons/05-independent-review/traces/REV01-review-2026-08-19T17-24-41-220Z.jsonl`

```text
controlled ARCH-01 defect injected after implementation
→ deterministic VERIFY PASS
→ REVIEW #1: exactly one grounded architecture blocker
→ review repair #1 changes tasks/task-routes.ts only
→ deterministic VERIFY PASS
→ REVIEW #2: pass
→ workflow success
```

Recorded outcome:

- intended finding detected: **true**;
- review attempts: **2**;
- review repair attempts: **1**;
- blocking false positives: **0**;
- repeated finding: **false**;
- final reviewer outcome: **pass**;
- final deterministic verification: **PASS**.

A prior REV01 run produced the same defect twice under different categories (architecture + correctness). Topic Chat rejected the resulting blanket `correctness + PASS → non-blocking` policy: deterministic PASS only proves encoded checks. The corrected policy preserves possible uncovered correctness blockers, and the rerun still passed the predefined REV01 decision rule.

### Topic Chat review

No blocking implementation issue remains after the correction pass.

Learning-critical boundaries are explicit:

1. verifier vs reviewer answer different questions;
2. reviewer is a fresh artifact-focused episode, not implementer self-review;
3. findings are structured, grounded candidate judgments rather than direct lifecycle authority;
4. harness owns finding acceptance, blocking policy, repair budget, re-verification, re-review, and stop;
5. review repair changes source state, so deterministic re-verification is mandatory;
6. repeated validated reviewer concerns are candidates for promotion into deterministic checks rather than permanent LLM review cost.

### Known non-blocking limits

1. REV01 proves the mechanism on one controlled explicit ARCH-01 violation, not broad natural reviewer quality.
2. `findingKey` repeat detection is literal; semantic deduplication across differently worded keys is deferred.
3. Finding/spec-conflict and in-scope checks are intentionally simple, not general semantic judges.
4. Reviewer quality without explicit architecture constraints is not demonstrated.
5. T01–T04 were intentionally not rerun in this module.
6. Finding aggregation/recurring-pattern analytics is deferred to tracing/evals; structured findings were retained so it can be added later.
7. Stable recurring rules should eventually be promoted to deterministic tests/linters when practical.

### Module 05 conclusion

The roadmap goal is satisfied at Topic Chat level:

```text
deterministic PASS
→ independent grounded review
→ harness-owned blocker decision
→ bounded review repair
→ deterministic re-verification
→ independent final re-review
```

The controlled evidence demonstrates that V3 can prevent acceptance of a deterministic-green engineering defect that the verifier does not encode, without giving the probabilistic reviewer direct lifecycle or write authority.

Topic Chat recommends formal Module 05 closure without adding more review machinery now.

---

## Module: 04 — Verification + bounded Repair

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-19.

Theory recap: `docs/learning/lessons/04-verification-repair/theory.md`  
Practical notes + traces: `docs/learning/lessons/04-verification-repair/`

### Built

- outer V2 loop: implementation episode → harness verification → normalized FAIL → bounded repair → verify again;
- `runAgentLoop` is an agent episode only; terminal response is not workflow completion authority;
- `normalizeFailure` produces compact factual failure evidence rather than diagnosis/prescribed fixes;
- harness-owned retry policy with `maxRepairAttempts = 2` and deterministic repeated-failure stop;
- repair receives resolved spec + failure evidence + existing context hints with the same source-only capability boundary;
- controlled R01 repair probe with benchmark-only one-shot fault injection;
- deterministic tests for policy, normalization, capability boundaries, and R01 result shape.

### R01 evidence

Observed trace:

```text
implementation episode
→ benchmark-only 404→500 fault
→ external verification #1 FAIL (`500 !== 404`)
→ normalized factual evidence
→ repair #1 receives resolved spec + failure evidence
→ repair writes `tasks/task-routes.ts` only
→ external verification #2 PASS
→ workflow = verified success
```

Recorded outcome:

- verification attempts: **2**;
- repair attempts: **1**;
- repeated failure: **false**;
- tests/spec/verifier were not modified;
- final success was decided by the outer harness verifier.

### Important conclusions

- **Agent owns the attempt; verifier owns the evidence; harness owns the consequence.**
- agent-controlled `npm test` is development feedback; harness-controlled verification is completion authority;
- deterministic operations remain ordinary software; LLM reasoning is used for diagnosis/repair judgment;
- failure normalization answers **what failed**, leaving **why/how to fix** to the repair model;
- retries must be bounded and harness-owned;
- verifier quality/coverage still bounds what “verified” can mean.

### Known non-blocking limits

1. `runV1Harness` is historical naming debt; actual behavior/trace is V2.
2. No-progress detection is intentionally minimal and does not catch all oscillation/useless-change patterns.
3. Rich lifecycle terminal semantics (`completed / blocked / needs_input / resume`) remain deferred.
4. R01 validates the repair mechanism on one controlled defect, not natural-error recovery rates or broad verifier quality.
5. Deterministic verification can still miss properties not encoded by its graders.
6. No independent reviewer exists yet.
7. Spec laundering remains a prior known limitation.

### Master closure

Module 04 satisfies the roadmap Verification + Test→Fix goal:

- completion authority is external to model prose;
- verification failure becomes structured evidence rather than an immediate dead end;
- repair is a bounded new reasoning episode conditioned on resolved spec + fresh evidence;
- re-verification is mandatory before workflow success;
- capability boundaries prevent the repair agent from modifying tests/spec/verifier;
- R01 trace directly demonstrates the intended FAIL → evidence → repair → PASS lifecycle.

No additional repair machinery is required before moving on.

---

## Module: 03 — Context Engineering

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-18.

Key outcome:

- targeted repo orientation + spec→implementation path reuse reduced blind discovery;
- T01–T03 correctness regression: 0/3;
- T04 escalation preserved;
- spec model calls 5→2; input tokens/wall time materially reduced;
- progressive disclosure keeps on-demand tools as an escape hatch.

Theory: `docs/learning/lessons/03-context-engineering/theory.md`.

---

## Module: 02 — Spec-Driven Development

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-17.

Key outcome:

- raw task passes through a physically read-only structured spec phase;
- `SpecDecision = executable | needs_human_judgment` gates implementation;
- T01–T03 remain autonomous/correct;
- T04 escalates before coding with no source changes.

Known limit: spec laundering remains probabilistically possible.

Theory: `docs/learning/lessons/02-spec-driven-development/theory.md`.

---

## Module: 01 — Agent Loop & Harness

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-13.

Key outcome:

- explicit Responses API `model → tool → observation → model` loop;
- bounded tools, independent final verification, JSONL traces;
- T01–T03 PASS;
- T04 exposed ambiguity/product-invention failure;
- terminal model text is not trusted as completion truth.

Theory: `docs/learning/lessons/01-agent-loop-harness/theory.md`.
