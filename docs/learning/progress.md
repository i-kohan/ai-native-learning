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

Current module: **12 — Planner / Worker / Reviewer** (in progress, not complete).

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
- optional in-episode Responses `previous_response_id` continuation inside `runAgentLoop`; default remains manual full-history replay because the Module 11 efficiency/adoption criterion was inconclusive.

Conceptual flow:

```text
raw task
→ isolated workspace from exact committed SHA
→ targeted context
→ read-only spec / ambiguity gate
→ implementation
→ deterministic VERIFY / bounded repair
→ independent REVIEW / bounded review repair
→ measured outcome
→ cleanup
```

Security note: this is still not a general sandbox; executed repository code can access host filesystem/network/subprocesses within OS account permissions.

Detailed evidence lives in `docs/learning/experiments.md` and `docs/learning/lessons/*`.

---

# Module 12 — Planner / Worker / Reviewer

**Status:** in progress — not complete. Experiment recorded; Planner is not the default; Topic Chat has not closed the module.

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

| Arm | expected | first VERIFY | repairs | calls/tools avg | tokens in/out avg | wall avg |
| --- | --- | --- | --- | --- | --- | --- |
| BASELINE | 3/3 | 3/3 PASS | 0 / 0 | 8 / 23 | 36,589 / 3,700 | ~51s |
| VARIANT | 3/3 | 3/3 PASS | 0 / 0 | 12 / 31 | 56,633 / 5,309 | ~64s |

Predefined rule: quality equal and Variant costs more end-to-end → **reject Planner**. Default unchanged.

Evidence: `docs/learning/lessons/12-planner-worker-reviewer/traces/planning-m12-2026-08-27T12-46-15-463Z.txt`

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
