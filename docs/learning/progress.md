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

Current execution core remains **V3 Spec-Driven + targeted context + bounded verify/repair + independent review**, with later capstone layers around it:

- systematic measurement: `HarnessRunResult → RunMetrics → EvalResult`;
- reusable `evidence-guided-repair` Skill, selectively loaded only for `repair` / `review_repair`;
- per-run Git worktree isolation from an exact `baseRevision`;
- workspace-bound tools/context/snapshots/verifier;
- minimal verification child environment allowlist so repository code does not inherit unrelated harness secrets;
- explicit harness-owned model-selection boundary: `resolveModel(episode, config)`;
- optional `OPENAI_REPAIR_MODEL` override applying only to verification repair;
- current normal routing policy remains one default model for all semantic episodes because Module 10 did not justify a permanent repair override.

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

## Next module

**11 — Modern Model-Native Orchestration / Inner vs Outer Loop**

Why now:

- Phase 2 reliability/safety layers are complete;
- Module 10 made model allocation an explicit, measurable harness-owned boundary;
- the current `master-learning-plan.md` places modern model-native inner orchestration immediately after Model Routing in Phase 3 — System Optimization;
- the next architectural question is no longer which model executes an episode, but which temporary reasoning/tool/subagent orchestration may safely live inside the model/provider runtime versus which state, policy, permissions, verification, retry, delivery and eval responsibilities must remain in the durable outer harness.

Do not start planner/worker/reviewer expansion, general subagents, durable execution, or distributed orchestration inside Module 11 unless needed only as a bounded illustration of the inner-vs-outer boundary.

---

## Module: 10 — Model Routing

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-25.

Theory: `docs/learning/lessons/10-model-routing/theory.md`  
Practical notes + evidence: `docs/learning/lessons/10-model-routing/`

### Built

- `resolveModel(episode, config)` as a single harness-owned model-selection boundary;
- routing episodes: `spec | implementation | repair | review | review_repair`;
- optional `OPENAI_REPAIR_MODEL` / `repairModel` override only for `repair`;
- `review_repair` deliberately remains independent from the verification-repair override;
- routing provenance: `episode`, selected `model`, `routingReason`;
- separate controlled routing experiment rather than inflating fixed-suite denominators;
- deterministic tests for routing semantics, authority preservation and R01 trial validity.

### Controlled routing experiment

Baseline:

```text
all semantic episodes → gpt-5.6-luna
```

Variant:

```text
spec / implementation / review / review_repair → gpt-5.6-luna
repair → gpt-5.6-terra
```

Predefined quality SLO:

```text
3/3 valid R01 trials per arm must satisfy the existing R01 FAIL→repair→PASS contract.
```

Fresh evidence:

`docs/learning/lessons/10-model-routing/traces/routing-m10-2026-08-25T10-54-03-280Z.txt`

```text
Luna repair   3 / 3 valid, SLO MET, contaminated 0
Terra repair  3 / 3 valid, SLO MET, contaminated 0
```

Averages:

```text
Luna:  repair ~12.2s, workflow ~31.2s, repair tokens ~17130 / 1031
Terra: repair ~10.5s, workflow ~30.5s, repair tokens ~17254 / 1009
```

Quality did not separate the models. Terra was somewhat faster in the repair episode, but end-to-end latency improvement was small while current official token pricing is substantially higher for Terra. Therefore permanent heterogeneous `repair → Terra` routing is **not enabled**.

Current normal policy:

```text
spec            → Luna
implementation  → Luna
repair          → Luna
review          → Luna
review_repair   → Luna
```

The routing boundary remains because future model/workload changes can be re-evaluated without scattering model selection across call sites.

### Fresh regression evidence

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

Routing comparison trials remain separate from the fixed `6/6` denominator. Harness unit tests: 94 passed.

### Master closure

Module 10 satisfies the intended Model Routing goal:

- routing key (`phase`), routing policy and model candidate/profile are conceptually separated;
- model selection is explicit and harness-owned rather than model-self-selected;
- switching model does not alter tools, permissions, retry limits, verification, review policy, Skills, workspace or security authority;
- all semantic model call sites use the resolver;
- routing provenance is traceable;
- the experiment defines quality SLO and contamination rules before interpreting results;
- repeated routing trials remain separate from representative/fixed eval denominators;
- economics are evaluated only after both candidates satisfy quality;
- the module accepts a negative allocation result instead of forcing heterogeneous routing;
- fixed harness contracts remain intact.

### Known non-blocking limits

1. Routing evidence covers one controlled verification-repair workload (R01), not broad natural repair diversity.
2. Three valid trials per arm are sufficient for the learning experiment, not strong statistical qualification.
3. No task-class, risk/health-aware or model-selected routing yet.
4. No fallback/escalation chain yet.
5. Model aliases, pricing and snapshots can drift; old routing economics require requalification.
6. Spec/reviewer quality is harder to route safely because important misses may not be observable to current deterministic graders.

No additional Model Routing infrastructure is required before moving on.
