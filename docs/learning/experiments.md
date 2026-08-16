# Experiments

## V0 baseline — Agent Loop & Harness

### Hypothesis

A minimal model-driven coding-agent loop with filesystem capabilities and executable feedback can autonomously complete small bounded coding tasks, but will expose limitations around reliability, completion judgment, and ambiguous intent.

### Baseline

V0 only: single agent, bounded tools, final `npm test`, no spec/planner/reviewer/repair.  
Model: `gpt-5.6-luna`

### Tasks

- T01 simple bug
- T02 multi-file `completedAt`
- T03 status filter feature
- T04 ambiguity probe

### Results

| Task | Final tests | Model calls | Tool calls | Wall time | Terminal | Verify agreed | Notable                                                               |
| ---- | ----------- | ----------- | ---------- | --------- | -------- | ------------- | --------------------------------------------------------------------- |
| T01  | PASS        | 6           | 12         | ~19s      | yes      | yes           | minimal `task-routes` fix; broad explore                              |
| T02  | PASS        | 6           | 12         | ~17s      | yes      | yes           | correct `task-service` layer                                          |
| T03  | PASS        | 6           | 12         | ~22s      | yes      | yes           | restored `list(status)`; tests-as-spec                                |
| T04  | FAIL        | 8           | 13         | ~41s      | yes      | **no**        | invented default pending; noted test conflict; still emitted terminal |

Lesson traces: `docs/learning/lessons/01-agent-loop-harness/traces/`

### T04 qualitative

- Identified ambiguity? Partially (chose an interpretation; did not frame as blocker)
- Asked for clarification? **No**
- Invented assumptions? **Yes** — omit `status` ⇒ pending only; completed via `?status=completed`
- Code change? **Yes** — `task-routes.ts`, `task-service.ts`
- Failure mode: `final_verification_failed` after terminal stop with red tests

### Observed failure modes

1. Ambiguous intent → product invention without escalation
2. Terminal stop with known failing test (model noted conflict, still stopped)
3. **Terminal response ≠ done** — V0 treats any no-tool-call message as loop end; “fixed” and “please clarify” are indistinguishable; clarify-only on green fixture would look like success
4. Soft: repeated broad discovery on T01–T03

### Initial conclusion

Hypothesis supported.

- Bounded clear tasks (T01–T03): V0 succeeds reliably when terminal stop + tests agree.
- Ambiguous intent (T04): exposes missing spec/escalation; external verify caught the bad code change.
- Additional V0 limit: stop semantics are “terminal message”, not “task done”.
- Next leverage is not multi-agent first — likely spec/clarification policy and/or repair after verify fail; context efficiency is secondary but visible.

Code note: result field renamed to `receivedTerminalResponse` (no escalation logic added in V0).

---

## V1 — Spec-Driven harness

### Hypothesis

A read-only structured spec phase plus an explicit harness gate can stop the T04 product-assumption failure (invented `default = pending`, then code change) without reducing autonomy on clear tasks T01–T03.

### V0 baseline

Same tasks, same model family (`gpt-5.6-luna`), V0 coding loop only:

| Task    | Outcome                          | Notes                                                                   |
| ------- | -------------------------------- | ----------------------------------------------------------------------- |
| T01–T03 | PASS                             | ~6 model calls / ~12 tools / ~17–22s                                    |
| T04     | FAIL `final_verification_failed` | invented pending default; modified `task-routes.ts` + `task-service.ts` |

### V1 variant

```text
raw task → read-only spec phase → SpecDecision → gate
  ├─ executable → existing V0 coding loop (spec as prompt contract) → npm test
  └─ needs_human_judgment → stop; no coding loop; no source changes
```

No repair, reviewer, planner, context builder, or skills.

### Tasks

- T01 simple bug (500 → 404)
- T02 `completedAt` on complete/reopen
- T03 status filter; omit `status` ⇒ all tasks (explicit in the task)
- T04 “hide completed when appropriate” (underspecified)

### Metrics

For each task: spec decision, ambiguity classes, whether implementation started, changed files, final tests (if impl ran), model/tool calls, wall time.

### Results

| Task | Spec                 | Impl   | Tests   | Model calls (spec) | Tools (spec) | Wall | Changed files     |
| ---- | -------------------- | ------ | ------- | ------------------ | ------------ | ---- | ----------------- |
| T01  | executable           | yes    | PASS    | 11 (5)             | 24 (12)      | ~37s | `task-routes.ts`  |
| T02  | executable           | yes    | PASS    | 11 (5)             | 21 (14)      | ~29s | `task-service.ts` |
| T03  | executable           | yes    | PASS    | 11 (5)             | 21 (12)      | ~26s | `task-service.ts` |
| T04  | needs_human_judgment | **no** | skipped | 5 (5)              | 13 (13)      | ~18s | none              |

Clear-task regression: **0 / 3**. Ambiguity handling: **correct on T04**.

Lesson copies: `docs/learning/lessons/02-spec-driven-development/traces/`  
T01 has trace only (run before `.spec.json` artifacts). T02–T04 include `.spec.json`.

### T04 qualitative (V1 vs V0)

- Identified ambiguity? **Yes** — `requires_human_judgment` / unresolved
- Escalated instead of implementing? **Yes**
- Invented `GET /tasks` default pending? **No**
- Coding loop started? **No**
- Source changes? **None**
- Unresolved questions: what “when appropriate” means; how hiding interacts with explicit `?status=completed`

T03 contrast: the same current “omit status → all tasks” fact was `repository_resolvable` because **the task text required preserving it**. T04 asked to change behavior without specifying the rule.

### Failures / unexpected behavior

- None against the success criteria.
- Spec generation still re-discovers the repo (~5 extra model calls on every task). Expected; out of scope.
- Gate cannot catch spec laundering if an invented requirement is written as resolved and no RHJ ambiguity is left unresolved. Did not happen on this T04 run.
- Coding loop consumes spec as formatted text, not as a typed object.

### Conclusion

Hypothesis supported.

- T01–T03: V1 stayed autonomous and correct.
- T04: structured spec + gate prevented the V0 product-invention failure without needing a reviewer or repair loop.
- Escalation on T04 was cheaper than V0’s failed implementation (~18s vs ~41s).
- Remaining leverage is still elsewhere: discovery/context cost; repair after verify fail; terminal-response ≠ done is unchanged inside the V0 loop.

Do not treat Module 02 as formally closed until Topic Chat review.
