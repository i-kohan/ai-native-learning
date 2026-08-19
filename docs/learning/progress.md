# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering
4. ✅ 04 — Verification + bounded Repair
5. ✅ 05 — Independent Review + bounded Review Repair

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
             → independent REVIEW #1 (clean artifact-focused context)
                ├─ no accepted blocker → success
                └─ accepted blocker
                   → one review repair (source only)
                   → deterministic VERIFY again
                   → REVIEW #2
                      ├─ pass → success
                      └─ accepted blocker → stop; no second review repair
```

Detailed evidence lives in `docs/learning/experiments.md` and the corresponding `docs/learning/lessons/*` folders.

## Next module

**06 — Tracing & Evals**

This intentionally combines roadmap topics **4.9 Tracing** and **4.10 Evals** into one module.

Why now:

- basic JSONL tracing and controlled experiments already exist from earlier modules, so a standalone introductory tracing module would mostly repeat existing practice;
- V3 now emits meaningful cross-episode signals: spec/implementation/repair/review phases, verification attempts, reviewer findings, accepted/rejected blockers, false positives, repeated findings, tokens and latency;
- without a systematic eval layer, the next optimization topics (skills, routing, subagents, orchestration) would be judged by anecdotes rather than comparable evidence;
- Module 05 explicitly exposed the need to retain/aggregate structured findings so recurring validated patterns can be promoted into deterministic checks;
- this is the right point to turn ad-hoc probes into a small repeatable task suite and episode-level metrics, without building a publication-grade statistics platform.

After Module 06, return to Phase 2 with **Skills**, then Worktrees / Isolation and Security.

Target after Module 06: **V3 + systematic observability/eval layer**. Do not add new agent roles merely for this module.

---

## Module: 05 — Independent Review + bounded Review Repair

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-19.

Theory recap: `docs/learning/lessons/05-independent-review/theory.md`  
Practical notes + traces: `docs/learning/lessons/05-independent-review/`

### Built

- independent reviewer starts only after deterministic VERIFY PASS;
- reviewer runs in a fresh model invocation with purpose-built context: resolved spec, current diff, architecture constraints, compact verification evidence;
- reviewer does not receive implementer conversation/reasoning/justification;
- structured `ReviewResult` / `Finding` with harness-owned acceptance policy;
- findings become `accepted_blocking`, `accepted_non_blocking`, or rejected with reason;
- max automatic review repair = 1;
- after review repair, deterministic verification is mandatory before REVIEW #2;
- REVIEW #2 cannot trigger a second repair;
- REV01 controlled architecture probe + deterministic policy tests.

### REV01 evidence

Primary corrected-policy trace:

`docs/learning/lessons/05-independent-review/traces/REV01-review-2026-08-19T17-24-41-220Z.jsonl`

Observed lifecycle:

```text
controlled ARCH-01 defect injected
→ deterministic VERIFY PASS
→ REVIEW #1 sees spec + diff + ARCH-01 + compact verify evidence
→ exactly one grounded architecture finding
→ harness accepts it as blocking
→ review repair #1 changes tasks/task-routes.ts only
→ deterministic VERIFY PASS
→ REVIEW #2 = pass
→ workflow success
```

Recorded outcome:

- intended finding detected: **true**;
- review attempts: **2**;
- review repair attempts: **1**;
- accepted blocking findings: **1**;
- blocking false positives: **0**;
- repeated finding: **false**;
- final reviewer outcome: **pass**;
- final deterministic verification: **PASS**.

A prior REV01 run produced duplicate/misclassified output (the same ARCH-01 problem restated as architecture + correctness). That evidence led to a policy/instruction correction rather than a blanket rule that all correctness findings after deterministic PASS are non-blocking. The corrected run satisfied the predefined decision rule.

### Master closure

Module 05 satisfies roadmap Independent Review → Repair:

- verifier and reviewer have distinct responsibilities;
- reviewer independence is achieved through fresh, artifact-focused context rather than implementer self-review;
- findings are grounded candidate judgments, not direct lifecycle authority;
- harness owns blocker acceptance, repair budget, re-verification, re-review and stop decisions;
- REV01 demonstrates a deterministic-green architectural defect being caught and repaired before acceptance;
- false-positive/overreach risk is explicitly represented rather than hidden;
- recurring validated reviewer rules are identified as candidates for later promotion into deterministic checks.

No additional reviewer machinery is required before moving on.

### Known non-blocking limits

1. REV01 is one controlled explicit ARCH-01 probe, not broad natural reviewer-quality evidence.
2. `findingKey` repeat detection is literal; semantic deduplication is deferred.
3. Reviewer quality without explicit architecture constraints is not demonstrated.
4. T01–T04 were not rerun in Module 05.
5. Finding aggregation / recurring-pattern analytics are not yet implemented.
6. Stable recurring reviewer rules should be promoted into deterministic checks when practical.

---

## Prior completed modules — compact recap

### 04 — Verification + bounded Repair

External deterministic FAIL becomes normalized evidence → bounded repair → mandatory re-verification. R01 demonstrated FAIL → repair → PASS. Harness, not model prose, owns completion.

Theory: `docs/learning/lessons/04-verification-repair/theory.md`.

### 03 — Context Engineering

Targeted repo orientation + spec→implementation path reuse reduced blind discovery and tokens/wall time while preserving clear-task correctness and T04 escalation.

Theory: `docs/learning/lessons/03-context-engineering/theory.md`.

### 02 — Spec-Driven Development

Raw intent passes through a physically read-only structured spec phase. `SpecDecision = executable | needs_human_judgment` gates coding side effects; T04 ambiguity is stopped before implementation.

Theory: `docs/learning/lessons/02-spec-driven-development/theory.md`.

### 01 — Agent Loop & Harness

Explicit model → tool → observation loop, bounded capabilities, external verification and traces. V0 established the baseline and exposed ambiguity/completion failures.

Theory: `docs/learning/lessons/01-agent-loop-harness/theory.md`.
