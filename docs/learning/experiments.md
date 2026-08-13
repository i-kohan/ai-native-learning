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

| Task | Final tests | Model calls | Tool calls | Wall time | Terminal | Verify agreed | Notable |
| ---- | ----------- | ----------- | ---------- | --------- | -------- | ------------- | ------- |
| T01  | PASS        | 6           | 12         | ~19s      | yes      | yes           | minimal `task-routes` fix; broad explore |
| T02  | PASS        | 6           | 12         | ~17s      | yes      | yes           | correct `task-service` layer |
| T03  | PASS        | 6           | 12         | ~22s      | yes      | yes           | restored `list(status)`; tests-as-spec |
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
