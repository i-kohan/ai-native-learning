# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering
4. ✅ 04 — Verification + bounded Repair
5. ✅ 05 — Independent Review + bounded Review Repair

Current harness: **V3 Spec-Driven + targeted context + bounded verify/repair + independent review**, plus a **small Module 06 measurement layer** (`RunMetrics` → `EvalResult`) that does not change V3 control flow.

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

## Next step

**Module 06 — Tracing & Evals is implemented at Topic Chat level and ready for review. It is not formally complete.**

Inspect `docs/learning/lessons/06-tracing-evals/`, the eval report, and `harness/src/eval/`. Do not treat 6/6 contracts as automatic module closure.

After formal Module 06 closure, return to Phase 2 with **Skills**, then Worktrees / Isolation and Security.

---

## Module: 06 — Tracing & Evals

**Status:** 🟡 IMPLEMENTED — awaiting Topic Chat / Master review. Not marked complete.

Theory recap: `docs/learning/lessons/06-tracing-evals/theory.md`  
Practical notes + traces/eval artifacts: `docs/learning/lessons/06-tracing-evals/`

### Built

- small measurement layer over existing V3 `HarnessRunResult` (no new tracing system, no V3 control-flow change);
- `normalizeRun` → compact `RunMetrics`;
- `aggregateRuns` → `EvalResult` + human-readable report;
- fixed-suite runner: `npm run benchmark:eval` (T01–T04 + R01 + REV01);
- deterministic semantic tests in `harness/tests/eval.test.ts`.

### Important design decisions

- T01–T04 = `capability_regression`; R01/REV01 = `mechanism_probe` and are excluded from natural first-pass denominators;
- T04 first-pass/eventual/recovered are `null`, not `false`; correct escalation is not a task failure;
- canonical verification count uses `verifications[]` execution order, not raw local attempt numbers;
- accepted/rejected reviewer findings are not auto-labeled true/false positives;
- REV01 ARCH-01 fields stay probe-specific;
- `escapedDefect` is `null` because the current grader is the same `npm test` as harness VERIFY;
- `failureLayer` is not auto-classified;
- recurring findings are candidates for human review, not auto-promotion;
- efficiency changes are diagnostics, not hard regressions.

### Suite result (2026-08-20)

```text
Capability / Regression
Expected outcomes      4 / 4
Executable tasks        3
First-pass success     3 / 3
Eventual success       3 / 3
Recovered success      0 / 3
Correct escalations    1 / 1
Autonomous completion  3 / 4
Human escalation       1 / 4
Known escaped defects   n/a

R01 verification repair      PASS
REV01 independent review     PASS
All fixed benchmark contracts  6 / 6
Hard regressions: none
```

Evidence: `docs/learning/lessons/06-tracing-evals/traces/2026-08-20T11-39-01-776Z.txt`

### Known limits

1. No independent hidden-test grader, so escaped-defect detection is N/A rather than false.
2. Spec-phase wall time is not separately instrumented.
3. `turns` is not a core eval metric.
4. Per-tool census is only spec+impl `list_files`/`read_file`.
5. No stored efficiency baseline, so token/time drift is not auto-warned.
6. Module is not formally closed.

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
5. Finding aggregation / recurring-pattern analytics were deferred to Module 06 and now exist as a minimal candidate list, not auto-promotion.
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
