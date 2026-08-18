# Learning Progress

## Module: 02 — Spec-Driven Development

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-17.

Theory recap: `docs/learning/lessons/02-spec-driven-development/theory.md`  
Practical notes + traces: `docs/learning/lessons/02-spec-driven-development/`

Current harness: **V1 Spec-Driven** (V0 coding loop preserved behind an explicit spec gate).

### Built

- Read-only spec phase (`list_files` / `read_file` / `submit_spec`)
- Structured `Spec` + `SpecDecision` (`executable` | `needs_human_judgment`)
- Harness gate before the existing V0 `runAgentLoop`
- Spec artifact next to traces: `traces/<runId>.spec.json`
- Benchmarks T01–T04 through V1
- Compact theory recap for later refresh

### Important design decisions

- Raw task is intent, not automatically an execution contract
- Spec phase cannot write source or run implementation side effects
- `needs_human_judgment` is a first-class workflow outcome, not `model_error` / `final_verification_failed`
- Harness forces escalation if any `requires_human_judgment` ambiguity is still `unresolved`, even if the model labeled the spec `executable`
- Coding loop still does not parse `Spec` as a typed object; the resolved spec is the user-message contract (`formatSpecContract`)
- Existing tests describe current behavior; they do not authorize inventing a new product rule
- Preserve autonomy for `repository_resolvable` and `safe_inference`; escalate material unresolved product/security/data/architecture judgment

### Tasks executed (V1)

| Task | Spec decision        | Impl started | Result     | Evidence                                                      |
| ---- | -------------------- | ------------ | ---------- | ------------------------------------------------------------- |
| T01  | executable           | yes          | PASS       | `lessons/02-spec-driven-development/traces/T01-...393Z.jsonl` |
| T02  | executable           | yes          | PASS       | `.../T02-...810Z.jsonl` + `.spec.json`                        |
| T03  | executable           | yes          | PASS       | `.../T03-...199Z.jsonl` + `.spec.json`                        |
| T04  | needs_human_judgment | **no**       | escalation | `.../T04-...888Z.jsonl` + `.spec.json`                        |

T01 spec.json is missing because that run happened before spec artifacts were added. Trace still contains the `spec_decision`; rerunning it is not required for the learning conclusion.

### Current results

- Clear-task regression: **0 / 3** (T01–T03 still PASS)
- T04: explicit unresolved product questions; no coding loop; no `target-app/src` changes; no invented `default = pending`
- Spec gate moved ambiguity handling before implementation side effects
- Cost: spec phase ~5 model calls; T01–T03 wall time ~26–37s vs V0 ~17–22s; T04 escalation ~18s vs V0 failed impl ~41s
- Discovery overhead on T01–T03 remains (not in scope)

### Observed failures / harness limits

1. Spec laundering is only partially mechanically preventable: if the model writes an invented rule into `requirements[]` and does **not** leave `requires_human_judgment` + `unresolved`, the gate will still execute
2. Spec is authoritative as prompt text, not as a typed contract the coding loop checks
3. Spec phase repeats repository discovery; V1 does not fix T01–T03 context overhead
4. Terminal response ≠ done remains unchanged inside the V0 coding loop
5. No repair loop after final verification failure (intentionally out of scope)

### Master closure

Module 02 is sufficient for its roadmap goal:

- raw intent is transformed into a structured, verifiable spec before implementation;
- ambiguity is classified into repository-resolvable / safe inference / requires-human-judgment boundaries;
- the spec phase is physically read-only and an explicit harness gate exists before coding side effects;
- T01–T03 remain autonomous and correct with 0/3 regression;
- T04 now escalates before implementation with no source changes, preventing the measured V0 product-invention failure;
- learning-critical execution flow, trade-offs, failure modes, and spec-laundering limits are documented;
- theory recap and experiment evidence are preserved in the repository.

No additional SDD mechanism is required before moving on. Spec laundering remains a known probabilistic limitation rather than a reason to expand Module 02 indefinitely.

## Next module

**03 — Context Engineering**

Why now:

- it is the next core dependency in the roadmap after SDD;
- V1 measured repeated repository discovery on every clear task, including ~5 extra spec-phase model calls;
- both spec generation and implementation need better targeted, authoritative context;
- improving context now creates a cleaner base before later Verification/Repair loops, reviewers, routing, or multi-agent orchestration.

Current harness entering Module 03: **V1 Spec-Driven**.
Target after Module 03: **V1 + minimal targeted context layer** (do not advance to repair/reviewer features yet).

---

## Module: 03 — Context Engineering

**Status:** 🔄 IN PROGRESS — implementation + experiment complete; Topic Chat review pending (not marked complete).

Practical notes + traces: `docs/learning/lessons/03-context-engineering/`  
`theory.md` is intentionally absent until Topic Chat writes it after review.

### Built

- `harness/src/context.ts` — deterministic `buildRepositoryMap`, hint formatting, `DiscoveryTracker`, path overlap + token aggregation helpers
- Spec phase receives compact repo map (variant only); captures successful `read_file` / `list_files` paths
- Implementation phase receives reusable context (repo map + spec inspected paths) while keeping full `list_files` / `read_file` / `write_file` tools
- `contextMode: baseline | variant` on `runV1Harness` and benchmark runner
- Structured `contextMetrics` on `HarnessRunResult` + trace events (`context_prepared`, discovery by phase)
- `npm run benchmark:experiment` — T01–T04 baseline then variant per task, fixture restored each run
- `harness/tests/context.test.ts` — deterministic map, hint semantics, tool availability, overlap tracking

### Important design decisions

- Context categories stay explicit: spec = authoritative intent; map = orientation; inspected paths = non-exhaustive starting hints
- No model call, embeddings, vector search, or full-file dump for map building — bounded filesystem walk only
- Baseline preserves prior V1 behavior (`contextMode=baseline` default)
- Variant adds preparation + injection at spec and implementation boundaries only; SDD gate unchanged
- Repeated `read_file` on a known path before edit is not classified as waste in harness metrics
- Context prep cost recorded (`contextMetrics.preparation.durationMs`, `pathsScanned`) so overhead is visible

### Experiment results (2026-08-18)

All 8 runs **expected**. Evidence: `docs/learning/lessons/03-context-engineering/traces/`

|         | Baseline                      | Variant                       |
| ------- | ----------------------------- | ----------------------------- |
| T01–T03 | executable → PASS             | executable → PASS             |
| T04     | needs_human_judgment, no impl | needs_human_judgment, no impl |

Key deltas (variant vs baseline):

- Spec `list_files`: **4 → 0** every task
- Spec model calls: **5 → 2** every task
- Impl `list_files` (T01–T03): **1–3 → 0**
- Impl nav before first write (T02/T03): **8 → 5**
- Wall time T01–T03: **−23% to −48%**
- Total input tokens T01–T03: **−13% to −33%**
- Context prep: **~0 ms**

Conclusion: minimal targeted context **helps** — reduces blind discovery and end-to-end cost without correctness or T04 regressions. See `docs/learning/experiments.md` § Module 03.

Current harness: **V1 Spec-Driven + optional context layer** (`contextMode=variant`).

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
