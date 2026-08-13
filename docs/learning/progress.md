# Learning Progress

## Module: 01 — Agent Loop & Harness

**Status:** baseline + docs ready for Master formal close / next-module choice  
**Not marked fully completed here — hand off to Master Chat.**

Human notes + traces: `docs/learning/lessons/01-agent-loop-harness/`

### Built

- `target-app/` — Task Board + `npm test`
- `harness/` — explicit Responses API agent loop
- Bounded tools + independent final verification + JSONL traces
- Benchmarks T01–T04
- Lesson notes + copied representative traces

### Important design decisions

- No agent framework; one readable loop
- Tests are completion truth; model text is not
- No auto-repair after final verify fail (intentional V0)
- Strict tool path/command boundaries
- Stop signal renamed to `receivedTerminalResponse` (not “claimed done”)
- V0 does **not** classify terminal text (done vs clarify vs blocked)

### Tasks executed

| Task | Result                             | Lesson trace                                             |
| ---- | ---------------------------------- | -------------------------------------------------------- |
| T01  | PASS                               | `lessons/01-agent-loop-harness/traces/T01-...115Z.jsonl` |
| T02  | PASS                               | `.../T02-...680Z.jsonl`                                  |
| T03  | PASS                               | `.../T03-...109Z.jsonl`                                  |
| T04  | FAIL (`final_verification_failed`) | `.../T04-...768Z.jsonl`                                  |

### Current results

- T01–T03: autonomous PASS, ~6 calls / ~12 tools, terminal + tests aligned
- T04: invented default pending filter; noted test conflict; still emitted terminal; verify failed
- Soft: broad discovery before small fixes

### Observed failures / harness limits

1. Ambiguous intent → product invention without escalation
2. Terminal response with known red tests (aware note, still stopped)
3. **Terminal response ≠ done:** any no-tool-call message ends the loop; clarify-only on a green fixture could look like success
4. Discovery overhead on easy tasks

### Open questions for Master / Topic close

- Next module: Spec/escalation first vs repair-first?
- How to represent “needs human” as a first-class terminal outcome later?
- When to invest in context/repo map?

### Remaining

Master Chat: formal Module 01 close + choose next roadmap module. No further V0 feature work planned.
