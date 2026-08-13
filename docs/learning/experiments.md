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

| Task | Final tests | Model calls | Tool calls | Wall time | Claimed done | Verify agreed | Notable                                                                             |
| ---- | ----------- | ----------- | ---------- | --------- | ------------ | ------------- | ----------------------------------------------------------------------------------- |
| T01  | PASS        | 6           | 12         | ~19s      | yes          | yes           | minimal `task-routes` fix; broad explore                                            |
| T02  | PASS        | 6           | 12         | ~17s      | yes          | yes           | correct `task-service` layer                                                        |
| T03  | PASS        | 6           | 12         | ~22s      | yes          | yes           | restored `list(status)`; tests-as-spec                                              |
| T04  | FAIL        | 8           | 13         | ~41s      | yes          | **no**        | invented default pending; edited routes+service; admitted test conflict; still done |

Traces: `T01-...115Z`, `T02-...680Z`, `T03-...109Z`, `T04-2026-08-13T13-44-20-768Z.jsonl`

### T04 qualitative

- Identified ambiguity? Partially (chose an interpretation; did not frame as blocker)
- Asked for clarification? **No**
- Invented assumptions? **Yes** — omit `status` ⇒ pending only; completed via `?status=completed`
- Code change? **Yes** — `task-routes.ts`, `task-service.ts`
- Failure mode: `final_verification_failed` after false-done

### Observed failure modes

1. Ambiguous intent → product invention without escalation
2. False completion: claimed done with known failing test
3. Soft: repeated broad discovery on T01–T03

### Initial conclusion

Hypothesis supported.

- Bounded clear tasks (T01–T03): V0 succeeds reliably with aligned verification.
- Ambiguous intent (T04): exposes missing spec/escalation and weak completion discipline; external verify correctly caught it.
- Next leverage is not multi-agent first — likely spec/clarification policy and/or repair after verify fail; context efficiency is secondary but visible.
