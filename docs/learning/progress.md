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
8. ✅ 08 — Worktrees / Isolation
9. ✅ 09 — Security Fundamentals
10. ✅ 10 — Model Routing
11. ✅ 11 — Modern Model-Native Orchestration / Inner vs Outer Loop
12. ✅ 12 — Planner / Worker / Reviewer
13. ✅ 13 — Subagents
14. ✅ 14 — Human-Reviewable Decomposition
15. ✅ 15 — Stronger Eval Methodology

Current module: **15 — Stronger Eval Methodology completed in Topic Chat on 2026-09-08.** Do not start Module 16 from this Topic Chat; Master owns the next step and the planned Phase-3 consolidation. Default architecture unchanged.

---

## Current execution core

The capstone remains **V3 Spec-Driven + targeted context + bounded verify/repair + independent review**, with later layers around it:

- systematic measurement: `HarnessRunResult → RunMetrics → EvalResult`;
- one reusable procedural Skill: `evidence-guided-repair`, selectively loaded only for `repair` / `review_repair`;
- per-run Git worktree isolation for benchmark/eval execution;
- exact workspace provenance via `baseRevision`;
- workspace-bound `repoRoot / targetAppRoot / targetSrcRoot`, so tools/context/snapshots/verifier operate on the run's workspace;
- verification children (`run_command("npm test")` and `runFinalVerification`) share one minimal env allowlist, so repository code does not inherit harness secrets such as `OPENAI_API_KEY`;
- deterministic harness-owned model routing through `resolveModel(episode, config)`; current normal policy keeps all episodes on `gpt-5.6-luna`;
- optional in-episode Responses `previous_response_id` continuation inside `runAgentLoop`; default remains manual full-history replay because the Module 11 efficiency/adoption criterion was inconclusive;
- optional explicit read-only Planner mechanism exists behind `planningEnabled`, but remains off by default because Module 12 P01 showed equal quality with worse end-to-end cost;
- optional Worker `delegate_research` exists behind `subagentsEnabled`, default `false`. Module 13 mechanism probe, not a change to the normal lifecycle;
- optional advisory ReviewPlan sequential units exist only when a binder is supplied (Module 14 experiment). Harness-owned `UnitExecutionScope` bounds each episode. Default remains one Worker;
- eval catalog distinguishes `dev` / `holdout` / `probe` / isolation / security. H01/H02 have a host-owned independent grader that runs after the harness terminal outcome. T01–T04 still have `escapedDefect=null` because their grader is VERIFY.

Conceptual default flow:

```text
raw task
→ isolated workspace from exact committed SHA
→ targeted context
→ read-only spec / ambiguity gate
→ implementation Worker (implicit planning)
→ deterministic VERIFY / bounded repair
→ independent REVIEW / bounded review repair
→ measured outcome
→ cleanup
```

Security note: this is still not a general sandbox; executed repository code can access host filesystem/network/subprocesses within OS account permissions.

Detailed evidence lives in `docs/learning/experiments.md` and `docs/learning/lessons/*`.

---

# Module 15 — Stronger Eval Methodology

**Status:** ✅ COMPLETED — Topic Chat review passed on 2026-09-08. Qualification claim **supported** on the frozen Module 15 workload / configured model. Default architecture unchanged.

Theory:

`docs/learning/lessons/15-stronger-eval-methodology/theory.md`

Practical notes/evidence:

`docs/learning/lessons/15-stronger-eval-methodology/notes.md`

## Learning-critical model

```text
DEV / known     = used to build, debug, or tune
HOLDOUT         = frozen representative work, unused for tuning
VERIFY          = harness gate the Worker can see
independent grader = benchmark-owned ground truth after terminal outcome
```

Holdout lifecycle:

```text
fresh holdout → evaluate
→ if used to change/tune the evaluated harness
→ becomes DEV/known for future qualification
```

H01/H02 remain `fresh_holdout` for the recorded qualification evidence because that result was not used to tune the harness.

## Qualification protocol (frozen before outcomes)

```text
T01–T04: 1 regression run each
H01: 3 independent trials from the same frozen base
H02: 3 independent trials from the same frozen base
Claim supported only if:
  T01–T04 no regression
  H01 independent grader 3/3
  H02 independent grader 3/3
  escaped defects 0
  grader calibration valid
```

`2/3` is unsupported, not inconclusive. `3/3` is an observed count, not 100% reliability.

## Result (2026-09-07)

Suite: `qualification-m15`. Configured model: `gpt-5.6-luna`. Base: `a6b8e5001298`. Invalid trials: none. Contaminated: none.

| Split | Result |
| --- | --- |
| T01–T04 | 4/4 expected; first-pass 3/3; T04 escalated |
| H01 independent grader | 3/3 PASS; escaped 0/3 |
| H02 independent grader | 3/3 PASS; escaped 0/3 |
| Calibration | valid |
| Verdict | **supported** |

H01 efficiency: wall median 41556ms (37431–74635); model calls median 8 (8–11); tool calls median 18 (16–21); tokens in median 27549 (26678–44651); tokens out median 3284 (3075–4799).

H02 efficiency: wall median 38464ms (30034–41537); model calls median 8 (7–9); tool calls median 16 (16–17); tokens in median 24480 (23493–33871); tokens out median 2870 (2509–3008).

Evidence: `docs/learning/lessons/15-stronger-eval-methodology/traces/2026-09-07T17-26-05-593Z.txt`

Harness unit tests at implementation time: **174 passed**.

## Topic Chat review

No blocking correctness issue was found in the qualification evidence or independent-grader boundary.

Confirmed:

- grader tests are host-owned and absent from normal Worker/VERIFY;
- Worker tools are rooted inside `target-app/`, with writes restricted to `target-app/src/`;
- grader runs after terminal harness outcome and before workspace cleanup;
- grading happens against a temporary staging copy of the final workspace;
- H01/H02 hidden tests check stated requirements, not hidden product requirements;
- DEV/HOLDOUT/probe denominators remain separate;
- all six recorded holdout runs had `expected=yes`, `VERIFY PASS`, independent grader PASS, and `escaped=false`.

Known limitations are intentionally documented rather than expanded into a production eval platform: only two same-domain holdouts, configured model identity is not a cryptographically pinned provider snapshot, grader stdout is not first-class normalized evidence, and a future qualification suite should explicitly gate on full holdout workflow success as well as grader results before looking at new outcomes.

## Module decision

```text
eval methodology     = implemented and understood
qualification claim  = supported on frozen Module 15 workload
H01/H02              = fresh holdout for recorded evidence
normal default       = unchanged
next step            = Master / Phase-3 consolidation, not Module 16 here
```

---

# Module 13 — Subagents (bounded research child)

**Status:** ✅ COMPLETED — formally accepted by Master. Mechanism implemented and measured. Default architecture unchanged (`subagentsEnabled=false`). P01 ROI inconclusive; natural Workers did not delegate (0/3).

Theory draft:

`docs/learning/lessons/13-subagents/theory.md`

Practical notes/evidence:

`docs/learning/lessons/13-subagents/notes.md`

## Learning-critical model

```text
Worker tool call
→ harness-owned delegation boundary
→ separate read-only child episode
→ validated EvidenceReport (advice, not authority)
→ Worker continues implementation
→ unchanged VERIFY / REVIEW
```

Key boundaries:

- agent-as-tool ≠ outer Planner phase;
- EvidenceReport ≠ Spec / permission / verification / success;
- evidence provenance is harness-observed: a child may only cite paths it actually read;
- child tools are physically restricted (`list_files` / `read_file` / `submit_evidence_report`);
- at most one child per Worker implementation episode;
- `subagentsEnabled=false` remains the default.

## Built

- optional Worker capability `delegate_research({ objective, scope })`;
- harness intercept in `runAgentLoop`;
- bounded read-only child in the same workspace;
- deterministic EvidenceReport admission, including harness-observed read provenance;
- P01 experiment `npm run benchmark:subagents`.

## Controlled experiment

Task: P01  
Context: `contextMode=variant`, `conversationStateMode=manual`  
Trials: 3 valid per arm. Contaminated: none.  
Delegation on variant: **0/3**.

| Arm      | expected | first VERIFY | repairs | calls/tools avg | tokens in/out avg | wall avg | delegated |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- | --------- |
| BASELINE | 3/3      | 3/3 PASS     | 0 / 0   | 9 / 21          | 38,579 / 4,036    | ~47s     | 0/3       |
| VARIANT  | 3/3      | 3/3 PASS     | 0 / 0   | 8 / 22          | 33,015 / 3,652    | ~42s     | 0/3       |

Quality equal. Child never ran, so e2e movement is Worker variance, not subagent ROI. Predefined rule → **mechanism understood / ROI inconclusive**. Do not treat unused `delegate_research` as a win or a reason to force the prompt.

Evidence: `docs/learning/lessons/13-subagents/traces/subagents-m13-2026-08-28T12-27-46-204Z.txt`

Mechanism correctness was proven separately by mocked unit tests (child cannot write/run/delegate; unread citations rejected; second call denied; parent continues).

## Fixed V3 regression

Suite: `fixed-v3-m09`. Subagents stayed off. 6/6 contracts; ISO01 PASS; SEC01 PASS; no hard regressions.

Evidence: `docs/learning/lessons/13-subagents/traces/2026-08-28T12-35-16-210Z.txt`

Harness unit tests: 140 passed (at Module 13 closure).

## Module decision

```text
research-child mechanism = implemented and understood
natural P01 adoption     = not justified / ROI inconclusive
normal default           = Spec → Worker, subagentsEnabled=false
```

Formally closed by Master. Do not reopen.

---

# Module 14 — Human-Reviewable Decomposition

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-01. Mechanism implemented and measured; not adopted as default.

Theory draft:

`docs/learning/lessons/14-human-reviewable-decomposition/theory.md`

Practical notes/evidence:

`docs/learning/lessons/14-human-reviewable-decomposition/notes.md`

## Learning-critical model

```text
Spec
→ [optional] advisory ReviewPlan (manual in this probe)
→ harness-owned UnitExecutionScope per episode
→ sequential semantic units with real source diffs
→ scoped VERIFY gate (FAIL stops later units)
→ final VERIFY / independent REVIEW
```

Key boundaries:

- task decomposition ≠ agent decomposition;
- file decomposition ≠ semantic decomposition;
- Spec ≠ ReviewPlan ≠ UnitExecutionScope;
- `single_change` is first-class;
- no stacked PRs, parallel workers, or LLM Review Planner in this probe.

## Built

- P02 due-date benchmark;
- ReviewPlan / ChangeUnit schema + admission + `UnitExecutionScope`;
- sequential unit snapshots, scoped verification gate, explicit `owns()` mapping;
- `npm run benchmark:decomposition`.

## First P02 experiment (negative)

Quality equal 3/3, first VERIFY PASS, 0 repairs. Variant ~2× cost. A absorbed the full feature; B empty 3/3; C empty 2/3. Advisory ReviewPlan did not bound execution.
