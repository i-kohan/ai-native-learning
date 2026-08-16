# Learning Progress

## Module: 02 — Spec-Driven Development

**Status:** implemented + V1 experiment done; **not formally complete** — Topic Chat review first.  
**Not marked fully completed here — hand off to Topic Chat.**

Practical notes + traces: `docs/learning/lessons/02-spec-driven-development/`  
(`theory.md` is for Topic Chat recap before Master close.)

Current harness: **V1 Spec-Driven** (V0 coding loop preserved behind an explicit spec gate).

### Built

- Read-only spec phase (`list_files` / `read_file` / `submit_spec`)
- Structured `Spec` + `SpecDecision` (`executable` | `needs_human_judgment`)
- Harness gate before the existing V0 `runAgentLoop`
- Spec artifact next to traces: `traces/<runId>.spec.json`
- Benchmarks T01–T04 through V1

### Important design decisions

- Spec phase cannot write source or run implementation side effects
- `needs_human_judgment` is a first-class workflow outcome, not `model_error` / `final_verification_failed`
- Harness forces escalation if any `requires_human_judgment` ambiguity is still `unresolved`, even if the model labeled the spec `executable`
- Coding loop still does not parse `Spec` as a typed object; the resolved spec is the user-message contract (`formatSpecContract`)
- Existing tests describe current behavior; they do not authorize inventing a new product rule

### Tasks executed (V1)

| Task | Spec decision        | Impl started | Result     | Evidence                                                      |
| ---- | -------------------- | ------------ | ---------- | ------------------------------------------------------------- |
| T01  | executable           | yes          | PASS       | `lessons/02-spec-driven-development/traces/T01-...393Z.jsonl` |
| T02  | executable           | yes          | PASS       | `.../T02-...810Z.jsonl` + `.spec.json`                        |
| T03  | executable           | yes          | PASS       | `.../T03-...199Z.jsonl` + `.spec.json`                        |
| T04  | needs_human_judgment | **no**       | escalation | `.../T04-...888Z.jsonl` + `.spec.json`                        |

T01 spec.json is missing: that run happened before spec artifacts were added. Trace still has `spec_decision`.

### Current results

- Clear-task regression: **0 / 3** (T01–T03 still PASS)
- T04: explicit unresolved product questions; no coding loop; no `target-app/src` changes; no invented `default = pending`
- Cost: spec phase ~5 model calls; T01–T03 wall time ~26–37s vs V0 ~17–22s; T04 escalation ~18s vs V0 failed impl ~41s
- Discovery overhead on T01–T03 remains (not in scope)

### Observed failures / harness limits

1. Spec laundering is only partially mechanically preventable: if the model writes an invented rule into `requirements[]` and does **not** leave `requires_human_judgment` + `unresolved`, the gate will still execute
2. Spec is authoritative as prompt text, not as a typed contract the coding loop checks
3. Spec phase repeats repository discovery; V1 does not fix T01–T03 context overhead
4. `theory.md` / formal module close are Topic Chat work

### Remaining

Topic Chat: review learning-critical flow, check understanding, write `theory.md`, decide module complete. Then commit/push. Master chooses the next module after that.

No V2 (repair / reviewer / context builder) work in this module.

---

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
