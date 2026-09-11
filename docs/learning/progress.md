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
15. ✅ 15 — Stronger Eval Methodology (closed by Master; see phase-3 consolidation)

Current module: **16 — Durable Execution** (mechanism implemented and measured; pending Topic Chat review). Not marked complete.

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
- eval catalog now distinguishes `dev` / `holdout` / `probe` / isolation / security. H01/H02 have a host-owned independent grader that runs after the harness terminal outcome. T01–T04 still have `escapedDefect=null` because their grader is VERIFY;
- opt-in durable workflow checkpoint `spec_required → implementation_ready` (Module 16 probe). Default `runV1Harness()` remains in-memory unless `durable` is passed. Experimental Planner/Subagent/ReviewPlan paths are explicitly unsupported on the durable path.

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

# Module 16 — Durable Execution

**Status:** implemented and measured. Mechanism probe DUR01 **passed** under the hardened independent-REVIEW assertion. Topic Chat owns formal closure. Not marked complete.

Theory draft:

`docs/learning/lessons/16-durable-execution/theory.md`

Practical notes/evidence:

`docs/learning/lessons/16-durable-execution/notes.md`

## Learning-critical model

```text
model proposes Spec
→ outer harness admits executable Spec
→ persist implementation_ready (checkpoint completed only after rename)
→ process may die
→ fresh process loads WorkflowState
→ bind/validate existing workspace
→ skip Spec
→ existing Worker → VERIFY → REVIEW
→ persist terminal
```

Durable identity is `workflowId`, not one Node `runId` / PID. Trace JSONL is evidence, not authoritative workflow state.

## Result (2026-09-11, post-review DUR01 hardening)

Task: T02 DEV. Control + interrupted/resumed. Harness unit tests: **191 passed**.

Executable PASS now requires Worker + VERIFY PASS + independent REVIEW `pass`, and arm expected outcome requires `finalReviewerOutcome === "pass"`.

| Arm | workflow | Spec | Worker | VERIFY | REVIEW | terminal |
| --- | --- | --- | --- | --- | --- | --- |
| Control | pid 45299 | ran | yes | PASS | pass | persisted |
| Process A | pid 46556 | ran once | no | n/a | skipped | `implementation_ready` persisted |
| Process B | pid 47362 | skipped (`specModelCalls=0`) | yes | PASS | pass | persisted |

Same interrupted workflow ID. Distinct PIDs and invocation IDs. Workspace/base `b5f17482124e` reused. All executable DUR01 assertions passed.

Evidence: `docs/learning/lessons/16-durable-execution/traces/DUR01-durable-2026-09-11T15-17-19-208Z.txt`

## Module decision (pending Topic Chat)

```text
durable checkpoint mechanism = implemented
DUR01                         = passed
default runV1Harness          = still in-memory unless durable is opted in
Module 17 generalized resume  = not started
```

---

# Module 15 — Stronger Eval Methodology

**Status:** implemented and measured. Qualification claim **supported** on this frozen workload/model snapshot. Topic Chat owns formal closure. Default architecture unchanged.

Theory draft:

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

H01/H02 remain `fresh_holdout`. This run did not tune the harness against them.

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

Suite: `qualification-m15`. Model: `gpt-5.6-luna`. Base: `a6b8e5001298`. Invalid trials: none. Contaminated: none.

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

Harness unit tests: **174 passed**.

## Module decision (pending Topic Chat)

```text
eval methodology     = implemented
qualification claim  = supported on this frozen workload / gpt-5.6-luna
H01/H02              = still fresh holdout (not used to tune)
normal default       = unchanged
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

Evidence: `docs/learning/lessons/14-human-reviewable-decomposition/traces/decomposition-m14-2026-08-29T11-20-11-746Z.txt`

## Corrected P02 experiment

Same 3×3, `contextMode=variant`, `conversationStateMode=manual`. Contaminated: none. Harness unit tests: **159 passed**.

| Arm      | expected | first VERIFY | repairs | calls/tools avg | tokens in/out avg | wall avg |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- |
| BASELINE | 3/3      | 3/3 PASS     | 0 / 0   | 11 / 25         | 56,861 / 5,539    | ~74s     |
| VARIANT  | 3/3      | 3/3 PASS     | 0 / 0   | 22 / 46         | 130,415 / 10,125  | ~128s    |

Quality equal. Intermediate units always PASS. Empty later diffs: 0. Real `base..A`, `A..B`, `B..C`. Variant still ~2× cost. Decision: **`candidate_pending_human_review`**. Default unchanged.

Evidence: `docs/learning/lessons/14-human-reviewable-decomposition/traces/decomposition-m14-corrected-2026-08-31T12-13-58-044Z.txt`

## Fixed V3 regression

Suite: `fixed-v3-m09`. Review decomposition stayed off. First post-probe run: 6/6 contracts; ISO01 PASS; SEC01 PASS.

Evidence: `docs/learning/lessons/14-human-reviewable-decomposition/traces/2026-08-29T11-33-40-045Z.txt`

After the correction: again 6/6; ISO01 PASS; SEC01 PASS; no hard regressions.

Evidence: `docs/learning/lessons/14-human-reviewable-decomposition/traces/2026-08-31T12-27-55-652Z.txt`

## Module decision

```text
review-decomposition mechanism = implemented + corrected + understood
P02 first experiment           = mechanism_failed / no genuine surfaces
P02 corrected experiment       = candidate_pending_human_review
adoption                       = conditional, not default
normal default                 = Spec → one Worker, single_change first-class
```

Closed by Topic Chat on 2026-09-01. See `docs/learning/lessons/14-human-reviewable-decomposition/closure.md`.

---

# Module 12 — Planner / Worker / Reviewer

**Status:** ✅ COMPLETED — formally closed by Topic Chat on 2026-08-27 after implementation review, controlled experiment, gap fixes, fresh fixed regression, theory rewrite, and understanding check.

Theory:

`docs/learning/lessons/12-planner-worker-reviewer/theory.md`

Practical notes/evidence:

`docs/learning/lessons/12-planner-worker-reviewer/notes.md`

## Learning-critical model

```text
Spec
WHAT must be true
(authority)

Planner
HOW we currently think we should get there
(advisory hypothesis)

Worker
HOW to actually get there given repository reality
(execution + local adaptation)

Reviewer
WHAT is wrong with what was actually produced
(independent judgment)

Orchestrator / harness
WHETHER each phase may run and WHAT happens next
(authority / lifecycle)
```

Key boundaries:

- `Spec > Plan`;
- Planner proposes; harness authorizes;
- role ≠ agent instance ≠ parallelism;
- Worker may locally adapt away from Plan based on repository truth;
- Reviewer does not receive Plan / Planner rationale / Worker reasoning by default;
- deterministic Plan admission checks structure, not semantic truth;
- explicit planning is an optimization candidate, not a mandatory layer.

## Built

- optional read-only Planner episode (`planningEnabled`, default `false`);
- structured advisory `Plan` via `submit_plan` + deterministic admission;
- Worker handoff: resolved Spec separately, Plan is hypothesis not authority;
- Reviewer contract unchanged (no Plan / Planner rationale / Worker conversation);
- P01 priority fixture + `npm run benchmark:planning`.

## Controlled experiment

Task: P01  
Context: `contextMode=variant`, `conversationStateMode=manual`  
Trials: 3 valid per arm, isolated worktree per trial. Contaminated: none.

| Arm      | expected | first VERIFY | repairs | calls/tools avg | tokens in/out avg | wall avg |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- |
| BASELINE | 3/3      | 3/3 PASS     | 0 / 0   | 8 / 23          | 36,589 / 3,700    | ~51s     |
| VARIANT  | 3/3      | 3/3 PASS     | 0 / 0   | 12 / 31         | 56,633 / 5,309    | ~64s     |

Predefined rule: quality equal and Variant costs more end-to-end → **reject Planner**. Default unchanged.

Evidence: `docs/learning/lessons/12-planner-worker-reviewer/traces/planning-m12-2026-08-27T12-46-15-463Z.txt`

Important interpretation:

```text
Worker-local savings ≠ system savings.
```

On P01 there were not even Worker-local savings: Worker model calls increased on Variant. The result only supports a workload-bounded conclusion: explicit Planner is not justified for this feature-sized task. It does not prove that explicit planning cannot help larger long-running work.

## Review gap fixes

- Plan admission now rejects general `dependsOn` cycles (not only self-deps / invalid indexes). Schema/admission only — no DAG executor.
- Equal-quality decision: no numeric “meaningful” e2e threshold was predefined, so directional efficiency improvement is **inconclusive**, not `candidate`. Clear e2e regression → reject. Conflicting e2e signals → inconclusive. Compared signals: model calls, tool calls, input tokens, output tokens, wall time.
- Historical P01 artifact is unchanged. Re-applying the operationalization still **rejects**: quality equal, all five e2e signals worse on Variant.

P01 was not rerun (admission/decision-report changes do not affect recorded Planner execution).

## Fixed V3 regression after gap fixes

Suite: `fixed-v3-m09`. Planner stayed off. 6/6 contracts; ISO01 PASS; SEC01 PASS; no hard regressions.

Evidence: `docs/learning/lessons/12-planner-worker-reviewer/traces/2026-08-27T13-21-46-170Z.txt`

Harness unit tests: 125 passed.

## Understanding check

Final Topic Chat check passed after one terminology correction.

The learner correctly identified that:

- Worker can deviate from Plan because Plan is advisory and repository truth may invalidate implementation details;
- Planner overhead must be counted end-to-end, not hidden by Worker-local metrics;
- an explicit Planner becomes more plausible on large/complex work where upfront decomposition may reduce backtracking and wasted execution;
- Reviewer should not receive Plan because anchoring can correlate Planner/Worker/Reviewer errors.

Correction:

```text
Spec    = WHAT must be true
Planner = HOW we currently intend to get there
Worker  = HOW to actually get there given repository reality
```

## Module decision

```text
explicit Planner mechanism = implemented and understood
explicit Planner default   = rejected for current feature-sized workload
normal default              = Spec → Worker
```

Revisit explicit planning only when a larger planning-sensitive workload provides evidence that decomposition/reliability gains can repay coordination overhead.

---

# Module 11 — Modern Model-Native Orchestration / Inner vs Outer Loop

**Status:** ✅ COMPLETED — formally closed by Topic Chat on 2026-08-26 after implementation, evidence review, decision correction, theory, and understanding check.

## Goal

Understand **where orchestration responsibility should live** as provider/model runtimes become more capable.

Core distinction:

```text
OUTER HARNESS
→ whether an action/episode should happen
→ policy / permissions / verification / transitions / workflow truth

INNER EPISODE
→ how to execute the currently allowed bounded objective
```

Theory:

`docs/learning/lessons/11-modern-model-native-orchestration/theory.md`

Practical notes:

`docs/learning/lessons/11-modern-model-native-orchestration/notes.md`

## Built

- `conversationStateMode = "manual" | "previous_response_id"`;
- default remains `manual`;
- `previous_response_id` is fully implemented and selectable with `--previous-response-id`;
- each `runAgentLoop` invocation starts a fresh response chain;
- implementation / repair / review_repair do not share one provider response chain across outer checkpoints;
- custom tools remain client-executed via `executeTool()`;
- traces record `conversationStateMode`, `responseId`, `previousResponseId`, `clientInputItemCount`, `clientInputBytes`;
- separate `npm run benchmark:orchestration` experiment; orchestration trials are not folded into the fixed 6/6 denominator.

## Controlled experiment

Task: T02  
Context: `contextMode=variant`  
Trials: 3 per arm, isolated exact-base worktree per trial.

| Arm | mode                 | expected | client items/bytes avg | tokens in/out avg | wall avg |
| --- | -------------------- | -------- | ---------------------- | ----------------- | -------- |
| A   | manual               | 3/3      | 43 / 53,349            | 17,178 / 1,570    | ~23.6s   |
| B   | previous_response_id | 3/3      | 7 / 14,315             | 19,831 / 1,888    | ~32.3s   |

Supported:

```text
correctness on T02                    3/3 both arms
previous_response_id chaining         yes
client full-history replay removed    yes in variant
custom tool authority preserved       yes
outer workflow authority preserved    yes
client payload materially reduced     yes
```

Not established:

```text
token improvement      no
latency improvement    no
stable regression      not proven with n=3
```

## Decision correction

The original generated report used post-hoc token/latency thresholds and therefore incorrectly emitted:

```text
candidate_to_adopt: yes
```

That historical artifact is intentionally preserved unchanged.

Authoritative correction:

`docs/learning/lessons/11-modern-model-native-orchestration/traces/decision-correction-2026-08-26.md`

Current decision:

```text
criterion 1–5      supported
criterion 6        inconclusive
candidate_to_adopt no
normal default     manual
variant            previous_response_id remains available
```

This is an eval-discipline result as well as an orchestration result: thresholds must not be invented after observing the data.

## Fresh variant regression evidence

The fixed suite below was run with `conversationStateMode = previous_response_id` to prove that the variant preserves current contracts when explicitly selected. It is **not** evidence that the variant became the default.

Evidence:

`docs/learning/lessons/11-modern-model-native-orchestration/traces/2026-08-26T11-39-08-076Z.txt`

```text
T01–T04 expected outcomes             4 / 4
Executable first-pass                 3 / 3
Correct escalation T04                1 / 1
R01 verification repair               PASS
REV01 independent review              PASS
ISO01 workspace isolation             PASS
SEC01 verification secret isolation   PASS
All fixed V3 contracts                6 / 6
Hard regressions                      none
```

Harness unit tests at experiment time: 104 passed.

## Understanding check

Final Topic Chat check passed. The learner correctly identified that:

- `baseRevision` / workspace provenance belongs to the outer harness because the harness controls the authoritative workspace;
- retry limits belong to the outer harness because the harness controls whether another semantic attempt is permitted;
- model/tool sequencing and temporary continuation may live inward, but policy, permissions, checkpoints and workflow truth stay outer.

## Learning-critical result

The provider can own more **temporary episode continuation** without owning:

- workspace/base provenance;
- tool permissions;
- VERIFY;
- repair/review counters;
- routing policy;
- human escalation;
- workflow success;
- eval truth.

The current engineering choice is therefore intentionally conservative:

```text
manual continuation = default
previous_response_id = proven mechanism / selectable variant
```

No additional provider-native orchestration infrastructure is required before moving on.

---

# Module 10 — Model Routing

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-25.

Theory:

`docs/learning/lessons/10-model-routing/theory.md`

Practical notes/evidence:

`docs/learning/lessons/10-model-routing/`

## Built

- `resolveModel(episode, config)` as one harness-owned model-selection boundary;
- routing episodes: `spec | implementation | repair | review | review_repair`;
- optional `OPENAI_REPAIR_MODEL` override only for verification `repair`;
- routing provenance: `episode`, selected `model`, `routingReason`;
- controlled R01 routing experiment separate from fixed-suite denominators.

## Routing experiment result

Baseline:

```text
all semantic episodes → gpt-5.6-luna
```

Variant:

```text
spec / implementation / review / review_repair → gpt-5.6-luna
repair → gpt-5.6-terra
```

Both candidates met the predefined R01 SLO 3/3. Quality did not separate them, while Terra did not show enough end-to-end benefit to justify the higher token economics.

Current normal policy remains:

```text
spec            → Luna
implementation  → Luna
repair          → Luna
review          → Luna
review_repair   → Luna
```

The routing boundary remains available for future requalification.

Fresh Module 10 regression evidence:

`docs/learning/lessons/10-model-routing/traces/2026-08-25T11-00-45-136Z.txt`

```text
T01–T04 expected outcomes    4 / 4
Executable first-pass        3 / 3
Correct escalation T04       1 / 1
R01 verification repair      PASS
REV01 independent review     PASS
ISO01 workspace isolation    PASS
SEC01 secret isolation       PASS
All fixed V3 contracts       6 / 6
Hard regressions             none
```

Known non-blocking limits:

1. Routing evidence covers one controlled R01 workload, not broad natural repair diversity.
2. Three trials per arm are learning evidence, not statistical qualification.
3. No task-class/risk/health-aware/model-selected routing yet.
4. No fallback/escalation graph yet.
5. Provider model capabilities/pricing can drift and require requalification.
6. Spec/reviewer quality remains harder to route safely because important misses may be invisible to deterministic graders.
