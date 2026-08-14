# Learning Progress

## Module: 01 — Agent Loop & Harness

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-13

Lesson recap: `docs/learning/lessons/01-agent-loop-harness/theory.md`  
Practical notes + traces: `docs/learning/lessons/01-agent-loop-harness/`

### Built

- `target-app/` — Task Board + `npm test`
- `harness/` — explicit Responses API agent loop
- Bounded tools + independent final verification + JSONL traces
- Benchmarks T01–T04
- Compact theory recap + practical lesson notes + representative traces

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

### Master closure

Module 01 is sufficient for its roadmap goal:

- atomic agent loop understood and implemented explicitly;
- model / harness / tool / environment boundaries exercised in a real runner;
- external verification is independent from model completion text;
- baseline experiment T01–T04 produced both successes and a useful failure;
- basic tracing/eval baseline exists for comparing future harness versions;
- concrete V0 limitations are documented rather than prematurely repaired;
- compact theory + practical evidence are preserved under `lessons/` for later refresh.

No further V0 feature work is required before moving on.

## Next module

**02 — Spec-Driven Development**

Why now: T04 exposed the next highest-leverage failure class — ambiguous intent was converted into an invented product decision instead of a safe explicit escalation. The roadmap's SDD layer directly addresses this by turning intent into a structured contract and separating repository-resolvable facts, safe defaults, and decisions requiring human judgment.

Current harness entering Module 02: **V0 Minimal Runner**.
Target after Module 02: **V1 Spec-Driven**.
