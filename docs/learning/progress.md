# Learning Progress

## Module: 01 — Agent Loop & Harness

**Status:** baseline T01–T04 complete; ready for Topic Chat review  
**Not marked fully completed yet.**

Human notes: `docs/learning/lessons/01-agent-loop-harness/notes.md`

### Built

- `target-app/` — Task Board + `npm test`
- `harness/` — explicit Responses API agent loop
- Bounded tools + independent final verification + JSONL traces
- Benchmarks T01–T04
- `docs/learning/lessons/` for human notes

### Important design decisions

- No agent framework; one readable loop
- Model never sole authority on completion
- No auto-repair after final verify fail (intentional V0)
- Strict tool path/command boundaries
- `progress`/`experiments` = process; `lessons/` = personal

### Tasks executed

| Task | Result                             | Trace                                       |
| ---- | ---------------------------------- | ------------------------------------------- |
| T01  | PASS                               | `traces/T01-2026-08-12T20-56-59-115Z.jsonl` |
| T02  | PASS                               | `traces/T02-2026-08-13T13-17-10-680Z.jsonl` |
| T03  | PASS                               | `traces/T03-2026-08-13T13-38-53-109Z.jsonl` |
| T04  | FAIL (`final_verification_failed`) | `traces/T04-2026-08-13T13-44-20-768Z.jsonl` |

### Current results

- T01–T03: autonomous PASS, ~6 model calls / ~12 tools, done≡verify
- T04: invented default pending filter, changed 2 files, claimed done while tests red
- Stable soft issue on T01–T03: broad discovery before small fix

### Observed failures

- T04 false-done after knowingly conflicting with existing test
- No clarification request on ambiguous product intent
- Discovery overhead on easy tasks

### Open questions for Topic Chat

- Spec/escalation next vs repair-first?
- How to grade T04-like tasks without hidden acceptance criteria?
- When to invest in context/repo map given discovery pattern?

### Remaining

Topic Chat review of module 01; then choose next roadmap module. Do not mark fully completed until that review.
