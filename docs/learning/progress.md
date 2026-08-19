# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering

Current module:

4. 🟡 04 — Verification + bounded Repair — implementation, R01 experiment, theory recap, and Topic Chat review complete; ready for Master closure.

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

## Next step

**Master should formally close Module 04 and choose the next roadmap module from `docs/learning/master-learning-plan.md`.**

Topic Chat does not select/implement the next module automatically.

---

## Module: 04 — Verification + bounded Repair

**Status:** 🟡 READY FOR MASTER CLOSURE — Topic Chat review completed on 2026-08-19.

Theory recap: `docs/learning/lessons/04-verification-repair/theory.md`  
Practical notes + traces: `docs/learning/lessons/04-verification-repair/`

### Built

- outer V2 loop: implementation episode → harness `npm test` → normalize FAIL → bounded repair → verify again;
- `runAgentLoop` is an episode only: terminal response ≠ verified success;
- `normalizeFailure` — compact factual evidence (what failed), not diagnosis or prescribed fix;
- harness-owned policy: `maxRepairAttempts = 2`, plus deterministic early stop on repeated signature when repair made no source change;
- repair episode gets resolved spec + failure evidence + existing context hints; same `target-app/src/` write boundary;
- R01 controlled repair probe (fault injection after implementation, benchmark-only);
- deterministic tests for policy, normalization, write boundary, and R01 outcome shape.

### Important design decisions

- `npm test` stays ordinary deterministic software; the LLM does not decide PASS/FAIL;
- agent-controlled `run_command("npm test")` remains development feedback; harness verification is completion authority;
- repair does not restart from raw task alone;
- fault injection is benchmark-only and runs once via `afterImplementationEpisode`;
- no reviewer, planner, skills, routing, worktrees, MCP, lifecycle state machine, or generic grader framework.

### Experiment

R01 only. T01–T04 were intentionally **not** rerun. No V1 baseline comparison.

Evidence: `docs/learning/lessons/04-verification-repair/traces/R01-repair-2026-08-18T12-45-24-448Z.jsonl`

| Check                                   | Result                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| first external verification             | FAIL (exit 1)                                                   |
| failure normalized                      | yes (`returns 404 when the task does not exist`, `500 !== 404`) |
| repairAttempts                          | 1                                                               |
| repair received spec + failure evidence | yes                                                             |
| repair write                            | `tasks/task-routes.ts` only                                     |
| second external verification            | PASS                                                            |
| workflow status                         | verified success                                                |
| repeatedFailure                         | false                                                           |

### Topic Chat review

No blocking implementation issue found.

Learning-critical boundaries are explicit:

1. `harness/src/run.ts` → `runVerifyRepairLoop`: verification/retry/completion authority;
2. `harness/src/failure.ts` → `normalizeFailure`: factual failure normalization;
3. `harness/src/repair.ts` → `nextRepairDecision` / `formatRepairContract`: retry policy and repair context;
4. `harness/src/loop.ts` → `runAgentLoop`: episode termination separated from verified workflow completion;
5. `harness/src/tools.ts`: physical source-only write boundary and bounded test command.

### Known non-blocking limits

1. `runV1Harness` is historical naming debt; actual behavior/trace is V2.
2. Current no-progress detector catches only same failure signature + no source change; richer oscillation detection is deferred.
3. Rich terminal/lifecycle semantics (`completed / blocked / needs_input / resume`) remain deferred to orchestration/lifecycle work.
4. R01 proves the repair mechanism on one controlled defect, not broad natural-error recovery rates or verifier quality.
5. Spec laundering remains a prior known limitation and was not part of Module 04.

### Module 04 conclusion

The roadmap goal is satisfied at Topic Chat level:

```text
external deterministic FAIL
→ normalized evidence
→ bounded repair
→ external re-verification
→ verified success
```

Harness, not model prose, owns completion and retry consequence. Topic Chat recommends formal Module 04 closure without adding more repair machinery now.

---

## Module: 03 — Context Engineering

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-18.

Theory recap: `docs/learning/lessons/03-context-engineering/theory.md`  
Practical notes + traces: `docs/learning/lessons/03-context-engineering/`

### Built

- deterministic compact repository map;
- explicit context formatting for spec and implementation phases;
- capture/reuse of paths inspected during spec generation;
- baseline/variant context mode;
- discovery/context metrics in traces;
- reproducible T01–T04 baseline vs targeted-context experiment.

### Practical result

Correctness / safety preserved:

- T01–T03: `executable → PASS` in baseline and variant;
- clear-task regression: **0 / 3**;
- T04: `needs_human_judgment` in both modes, no implementation, no source changes.

Measured context improvements in the variant:

- spec `list_files`: **4 → 0** on every task;
- spec model calls: **5 → 2** on every task;
- implementation `list_files`: **1–3 → 0** on T01–T03;
- T01–T03 wall time: approximately **−23% to −48%**;
- T01–T03 total input tokens: approximately **−13% to −33%**;
- T04 total input tokens: approximately **−51%**;
- deterministic context preparation cost: negligible on this repository.

### Important conclusions

- context engineering is broader than prompt wording: it controls what information reaches each inference and when;
- a small eager orientation + on-demand tools is better here than either blind discovery or a full repository dump;
- progressive disclosure must preserve an escape hatch: hints are starting points, not an exhaustive scope;
- repository evidence/relevance does not create authority for new product semantics;
- repeated fresh `read_file` on a known path before edit is not the same as repeated blind discovery;
- deterministic software is appropriate for factual orientation; LLM judgment may become useful later for semantic relevance on larger repositories.

### Known limits after Module 03

1. Spec laundering remains possible.
2. Context selection is still simple/static; no need for embeddings/vector memory yet.
3. No independent reviewer yet.

---

## Module: 02 — Spec-Driven Development

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-17.

Theory recap: `docs/learning/lessons/02-spec-driven-development/theory.md`

Key outcome:

- raw task now passes through a physically read-only structured spec phase;
- `SpecDecision = executable | needs_human_judgment` gates implementation;
- T01–T03 remain autonomous and correct;
- T04 escalates before coding with no source changes, preventing the measured V0 product-invention failure.

Known remaining SDD limitation: spec laundering is probabilistically possible if an invented requirement is incorrectly represented as already resolved.

---

## Module: 01 — Agent Loop & Harness

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-13.

Theory recap: `docs/learning/lessons/01-agent-loop-harness/theory.md`

Key outcome:

- explicit Responses API `model → tool → observation → model` loop;
- bounded tools, independent final verification, JSONL traces;
- T01–T03 PASS;
- T04 exposed ambiguity/product-invention failure;
- terminal model text is not trusted as completion truth.
