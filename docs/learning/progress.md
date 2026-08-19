# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering
4. ✅ 04 — Verification + bounded Repair

Current harness: **V2 Spec-Driven + targeted context + bounded verify/repair**.

Current execution flow:

```text
raw task
→ deterministic context preparation / repo orientation
→ read-only spec phase
→ SpecDecision
   ├─ needs_human_judgment → stop before coding side effects
   └─ executable
       → implementation episode with reusable context hints + bounded tools
       → harness-owned external verification
          ├─ PASS → verified success
          └─ FAIL → normalized factual evidence
                    → bounded repair policy
                    → repair episode
                    → external verification again
                    → PASS / retry / stop
```

Detailed evidence lives in `docs/learning/experiments.md` and the corresponding `docs/learning/lessons/*` folders.

## Next module

**05 — Independent Review → Repair**

Why now:

- deterministic verification/repair is now a working external feedback loop;
- deterministic checks only validate properties they actually encode, so a green verifier can still miss semantic, architectural, or review-quality defects;
- the roadmap places independent review immediately after Test → Fix;
- this is the first intentionally small multi-agent pattern: a reviewer with clean context evaluates the verified diff independently, then bounded repair handles actionable findings;
- tracing/evals already exist at a basic level and should be deepened after the review loop exists so they can measure reviewer value, false positives, repeated findings, and cost.

Target after Module 05: **V3 — Independent Review + bounded Review Repair**.

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
