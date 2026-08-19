# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering

Current harness: **V1 Spec-Driven + targeted context layer**.

Current execution flow:

```text
raw task
→ deterministic context preparation / repo orientation
→ read-only spec phase
→ SpecDecision
   ├─ needs_human_judgment → stop before coding side effects
   └─ executable
       → implementation loop with reusable context hints + full tools
       → independent final verification
```

Detailed evidence lives in `docs/learning/experiments.md` and the corresponding `docs/learning/lessons/*` folders.

## Next module

**04 — Verification & Repair**

Why now:

- the harness already has external final verification, but it is a one-shot terminal check rather than a feedback loop;
- a failed verifier currently ends the run instead of feeding normalized failure evidence back into a bounded repair attempt;
- `terminal response ≠ done` remains a known completion-semantics weakness inside the coding loop;
- verification / test→fix is the next highest-leverage reliability layer before independent reviewer, routing, multi-agent work, or durable orchestration.

`Tools & Capability Design` remains a core roadmap concept, but a separate module is not required right now: capability boundaries have already been exercised through bounded V0 tools, the physically read-only spec phase, and deterministic context preparation. Tool design should continue to be made explicit inside verifier/repair interfaces rather than adding a standalone framework.

Target after Module 04: **V2 — Verification + bounded Repair**.

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
- implementation navigation before first write: **8 → 5** on T02/T03;
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
3. Terminal response ≠ done remains inside the coding loop.
4. Final verification is one-shot; there is no repair loop.
5. No independent reviewer yet.

### Master closure

Module 03 is sufficient for its roadmap goal:

- context lifecycle, progressive disclosure, eager vs on-demand context, repository legibility, over-filtering risk, authority/provenance, and phase-specific context are captured in the theory recap;
- learning-critical context boundaries are explicit in the harness;
- the experiment demonstrates a real efficiency improvement rather than only architectural cleanliness;
- correctness and T04 escalation were preserved;
- remaining limitations are documented instead of being prematurely solved with retrieval/memory complexity.

No additional Context Engineering mechanism is required before moving on.

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

## Module: 04 — Verification + bounded Repair

**Status:** 🔄 IN PROGRESS — implementation + R01 probe complete; Topic Chat review pending (not marked complete).

Practical notes + traces: `docs/learning/lessons/04-verification-repair/`  
`theory.md` is intentionally absent until Topic Chat writes it after review.

### Built

- Outer V2 loop: implementation episode → harness `npm test` → normalize FAIL → bounded repair → verify again
- `runAgentLoop` is an episode only: terminal response ≠ verified success
- `normalizeFailure` — compact factual evidence (what failed), not a diagnosis or prescribed fix
- Harness-owned policy: `maxRepairAttempts = 2`, plus deterministic stop on repeated signature with no source change
- Repair episode gets resolved spec + failure evidence + existing context hints; same `target-app/src/` write boundary
- R01 controlled repair probe (fault injection after implementation, benchmark-only)
- Deterministic tests for policy, normalization, write boundary, and R01 outcome shape

### Important design decisions

- `npm test` stays ordinary deterministic software; the LLM does not decide pass/fail
- Agent-controlled `run_command` (`npm test`) remains an observation tool; harness verification is completion authority
- Repair does not restart from the raw task alone
- Fault injection is not production harness behavior; it runs once via `afterImplementationEpisode` and fails loudly if preconditions are missing
- No reviewer, planner, skills, routing, worktrees, MCP, or generic grader framework

### Experiment

R01 only. T01–T04 were **not** rerun. No V1 baseline comparison.

Evidence: `docs/learning/lessons/04-verification-repair/traces/R01-repair-2026-08-18T12-45-24-448Z.jsonl`

| Check                                   | Result                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| first external verification             | FAIL (exit 1)                                                   |
| failure normalized                      | yes (`returns 404 when the task does not exist`, `500 !== 404`) |
| repairAttempts                          | 1                                                               |
| repair received spec + failure evidence | yes (`repair_started.promptIncludesSpec/FailureEvidence`)       |
| second external verification            | PASS                                                            |
| workflow status                         | verified success                                                |
| repair write                            | `tasks/task-routes.ts` only                                     |

### Current results

V2 loop works on this controlled probe. Final workflow diff empty because implementation was a no-op on a green fixture and repair undid the injected 500.

Module 04 is **not** complete until Topic Chat reviews the learning-critical code and R01 evidence.

Current harness: **V2 Spec-Driven + context layer + bounded verify/repair**.

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
