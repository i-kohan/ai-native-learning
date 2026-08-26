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

---

## Module 03 — Context Engineering (minimal targeted context)

### Hypothesis

A small amount of deliberately prepared and reused repository context can reduce repeated repository discovery between the spec and implementation phases while preserving V1 correctness and T04 escalation behavior.

### Baseline

V1 Spec-Driven unchanged: `contextMode=baseline` (default). No repo map injection; no spec→impl path reuse.

```text
raw task → spec phase → gate → implementation (spec contract only)
```

### Variant

V1 + minimal context layer: `contextMode=variant`.

```text
raw task
→ buildRepositoryMap (deterministic, bounded, no model)
→ spec phase (+ map orientation; on-demand tools; capture inspected paths)
→ gate (unchanged)
→ implementation (+ map + spec inspected paths as hints; on-demand tools retained)
→ final verification
```

Same model, task text, fixture, tool permissions, verification, and repository state as baseline.

Run:

```bash
cd harness && npm run benchmark:experiment
# or single task/mode:
npm run benchmark -- T01 --baseline
npm run benchmark -- T01 --variant
```

### Metrics captured

Per run in trace `run_completed.contextMetrics` and harness stdout:

- total / spec / impl model calls; total / spec tool calls
- spec & impl `list_files` / `read_file` counts and paths
- read/list path overlap (spec ∩ impl)
- impl repository navigation calls before first `write_file`
- context prep duration + paths scanned
- token usage when Responses API returns `usage` (not fabricated if absent)
- wall time

### Results

Evidence traces (2026-08-18 run, GitHub copies): `docs/learning/lessons/03-context-engineering/traces/`  
(local originals under `traces/` are gitignored.)

| Task | Mode     | Spec                 | Impl | Tests | Model (spec) | Tools (spec) | list (spec) | read (spec) | list (impl) | read (impl) | overlap (read)                                   | nav before write | prep ms | wall ms | Tokens in/out (total) |
| ---- | -------- | -------------------- | ---- | ----- | ------------ | ------------ | ----------- | ----------- | ----------- | ----------- | ------------------------------------------------ | ---------------- | ------- | ------- | --------------------- |
| T01  | baseline | executable           | yes  | PASS  | 9 (5)        | 17 (12)      | 4           | 7           | 1           | 2           | task-routes, tasks.test                          | 3                | 0       | 27263   | 20440 / 1842          |
| T01  | variant  | executable           | yes  | PASS  | 6 (2)        | 13 (8)       | 0           | 7           | 0           | 3           | task-routes, task-service, tests.test            | 3                | 0       | 20858   | 17737 / 1830          |
| T02  | baseline | executable           | yes  | PASS  | 11 (5)       | 22 (12)      | 4           | 7           | 3           | 5           | app, routes, service, types, tests.test          | 8                | 0       | 41851   | 26489 / 1940          |
| T02  | variant  | executable           | yes  | PASS  | 6 (2)        | 14 (7)       | 0           | 6           | 0           | 5           | app, routes, service, types, tests.test          | 5                | 0       | 26215   | 17783 / 1809          |
| T03  | baseline | executable           | yes  | PASS  | 10 (5)       | 22 (12)      | 4           | 7           | 3           | 5           | app, routes, service, types, tests.test          | 8                | 0       | 49446   | 23638 / 1786          |
| T03  | variant  | executable           | yes  | PASS  | 6 (2)        | 14 (7)       | 0           | 6           | 0           | 5           | package.json, routes, service, types, tests.test | 5                | 1       | 25489   | 17458 / 1473          |
| T04  | baseline | needs_human_judgment | no   | skip  | 5 (5)        | 11 (11)      | 4           | 6           | n/a         | n/a         | (none)                                           | n/a              | 0       | 80279   | 9003 / 1034           |
| T04  | variant  | needs_human_judgment | no   | skip  | 2 (2)        | 7 (7)        | 0           | 6           | n/a         | n/a         | (none)                                           | n/a              | 0       | 14942   | 4444 / 971            |

Clear-task regression: **0 / 3** in both modes. T04 escalation preserved in both modes.

### Repeated-discovery observations

- **Spec `list_files` eliminated in variant (4 → 0)** on every task — the deterministic map replaced blind directory listing during spec generation.
- **Spec model calls dropped 5 → 2** on all tasks — fewer spec-phase turns after initial orientation.
- **Implementation `list_files` dropped to 0** on T01–T03 variant — impl started from known paths instead of re-listing the tree.
- **Read overlap is high on T01–T03** — variant impl re-read paths already inspected in spec (expected: fresh content before edit, not blind re-discovery).
- **Impl nav before first write:** T02/T03 improved 8 → 5; T01 unchanged at 3 (already minimal).
- **Spec still performs on-demand `read_file`** (6–7 calls) — map orients but does not replace evidence gathering for spec authority.
- T04 variant did **not** launder ambiguity into executable — same gate outcome with fewer discovery turns.

### T04 safety

Both modes: `needs_human_judgment`, implementation not started, no changed files. Variant did not weaken escalation despite supplying repository map and spec inspected paths.

### Token data

From Responses API `usage` aggregated in traces (reliable on this run):

| Task | Mode     | Spec in/out | Impl in/out  | Total in/out | Δ total in |
| ---- | -------- | ----------- | ------------ | ------------ | ---------- |
| T01  | baseline | 9349 / 843  | 11091 / 999  | 20440 / 1842 | —          |
| T01  | variant  | 4610 / 829  | 13127 / 1001 | 17737 / 1830 | **−13%**   |
| T02  | baseline | 9514 / 1260 | 16975 / 680  | 26489 / 1940 | —          |
| T02  | variant  | 4515 / 1230 | 13268 / 579  | 17783 / 1809 | **−33%**   |
| T03  | baseline | 9538 / 1104 | 14100 / 682  | 23638 / 1786 | —          |
| T03  | variant  | 4512 / 878  | 12946 / 595  | 17458 / 1473 | **−26%**   |
| T04  | baseline | 9003 / 1034 | —            | 9003 / 1034  | —          |
| T04  | variant  | 4444 / 971  | —            | 4444 / 971   | **−51%**   |

Spec-phase input tokens roughly halved. T01 variant impl input is slightly higher (+18%) — likely from larger initial hint block — but end-to-end total input still decreased.

### Context preparation cost

`prep_ms = 0` on all runs (sub-millisecond deterministic walk; rounded in summary table). Overhead is not hiding work elsewhere.

### Failures / unexpected behavior

- None against correctness guardrails.
- T04 baseline wall time (~80s) is an outlier vs prior V1 T04 (~18s) — likely model latency/reasoning on that run, not harness regression; variant T04 ~15s.
- Variant does not eliminate spec-phase `read_file` — by design; map is orientation only.

### Conclusion

**Hypothesis supported** under the predefined decision rule:

1. T01–T03: zero correctness regressions (executable → PASS).
2. T04: escalation preserved; no implementation side effects.
3. Blind repository discovery materially reduced on all T01–T03 tasks (`list_files` in spec and impl → 0; spec model calls 5 → 2; high read overlap).
4. Context preparation overhead negligible (`prep_ms ≈ 0`).
5. End-to-end improvement: wall time −23% to −48% on T01–T03; total input tokens −13% to −33%; model calls reduced 9–11 → 6 on clear tasks.

The minimal context layer is **useful for this harness** — not merely cleaner architecture. It reuses orientation and spec-inspected paths without restricting tools or weakening the SDD gate.

Lesson copies: `docs/learning/lessons/03-context-engineering/traces/` (8 runs × jsonl + spec.json).  
`notes.md` is in the same folder. `theory.md` is for Topic Chat after review.

Module 03 experiment complete; formal module closure still pending Topic Chat review.

---

## Module 04 — Verification + bounded Repair (R01 controlled probe)

### Hypothesis

An explicit bounded VERIFY → REPAIR → VERIFY loop, with deterministic tests as completion authority and compact factual failure evidence for repair, can recover a repairable implementation defect without treating the model's terminal response as verified success.

### What this experiment is

A **controlled repair probe**, not a spontaneous-error benchmark.

R01:

1. starts from the green benchmark fixture;
2. runs normal spec + implementation (task already satisfied by the fixture);
3. injects one deterministic missing-task `404 → 500` defect into application source;
4. runs the harness verifier (must FAIL);
5. gives V2 repair the resolved spec + normalized failure evidence;
6. verifies again (must PASS).

Fault injection exists only in benchmark/probe code, runs once, and is not production harness behavior.

### What this experiment is not

- Not a T01–T04 regression suite
- Not a V1 vs V2 baseline comparison
- Not a measurement of how often the model spontaneously ships a wrong implementation
- Not a generic grader / reviewer / multi-agent study

### Variant

```text
spec gate → implementation episode (terminal ≠ done)
→ [R01] inject getTask 404→500 once
→ harness npm test
   FAIL → normalizeFailure → repair episode (max 2) → npm test
   PASS → verified success
```

Model: same family as prior modules (`gpt-5.6-luna`). Context mode: `variant`.

```bash
cd harness && npm run benchmark:r01
```

### Results

Evidence: `docs/learning/lessons/04-verification-repair/traces/R01-repair-2026-08-18T12-45-24-448Z.jsonl` (+ `.spec.json`)

| Field              | Value                                                     |
| ------------------ | --------------------------------------------------------- |
| spec               | executable                                                |
| impl started       | yes (no source change on green fixture)                   |
| first verify       | **FAIL** exit 1                                           |
| normalized         | `returns 404 when the task does not exist`; `500 !== 404` |
| repairAttempts     | **1**                                                     |
| repair model/tools | 4 / 6                                                     |
| repair write       | `tasks/task-routes.ts` only                               |
| second verify      | **PASS** exit 0                                           |
| workflow           | **verified success**                                      |
| repeatedFailure    | false                                                     |
| wall               | ~94s                                                      |
| tokens in/out      | 25383 / 2034 (repair 14118 / 1028)                        |
| outcome            | **expected**                                              |

Repair prompt included the resolved spec and factual failure evidence (`repair_started.promptIncludesSpec`, `promptIncludesFailureEvidence`). Tests/spec/verifier were not modified; `write_file` stayed under `target-app/src/`.

Final workflow `changed_files` is empty because the injected defect was reverted to the original fixture. That is expected for this probe; the repair episode diff is the evidence that repair changed source.

### Failures / unexpected behavior

None against the R01 success criteria.

### Conclusion

Hypothesis supported **for this controlled defect**:

```text
external deterministic verification FAIL
→ failure evidence reaches repair
→ repair modifies implementation
→ external verification runs again
→ PASS
→ harness-owned verified success
```

This does **not** prove that V2 will recover naturally occurring agent mistakes, or that T01–T04 remain unchanged.

Module 04 experiment recorded; formal module closure still pending Topic Chat review.

---

## Module 05 — Independent Review + bounded Review Repair (REV01 controlled probe)

### Hypothesis

An independent reviewer with a clean, purpose-built context (resolved spec + current diff + explicit architecture constraints + compact verification evidence) can detect an architectural defect that deterministic tests already accepted, and a single harness-bounded review repair can restore the constraint without a second automatic repair.

### What this experiment is

A **controlled review probe**, not a spontaneous-error benchmark and not a reviewer OFF vs ON comparison.

REV01:

1. starts from the green benchmark fixture;
2. runs normal spec + implementation (complete-task behavior already satisfied);
3. injects one deterministic ARCH-01 defect: `completeTask` in `task-routes.ts` uses `service.get(id)` and directly mutates `Task.status` / `Task.completedAt`;
4. first harness `npm test` must PASS (V2 completion condition would have accepted this state);
5. REVIEW #1 must report the intended architecture violation with concrete evidence and ARCH-01;
6. harness accepts exactly that finding as the blocking repair signal;
7. one review repair runs, then deterministic verification, then REVIEW #2 with no accepted blocker.

Fault injection exists only in benchmark/probe code, runs once, and is not production harness behavior.

### Why there is no baseline

The probe is designed so the previous V2 completion condition is already satisfied after injection (`npm test` PASS). A separate reviewer-OFF run would only restate that fact. The evidence that V2 would have accepted the defect is the first deterministic PASS on the injected state.

### Predefined ground truth

True-positive blocker:

- conceptual findingKey: `task-state-transition-outside-service` (exact string not required);
- category: `architecture`;
- problem: `task-routes.ts` directly owns/mutates `Task.status` and/or `Task.completedAt`, violating ARCH-01;
- evidence is sufficient only if the reviewer identifies the concrete `completeTask` / route mutation and connects it to ARCH-01.

Any other accepted blocking finding is a blocking false positive unless independently justified by this ground truth.

### Decision rule

REV01 demonstrates reviewer value only if all are true:

1. controlled ARCH-01 violation is injected;
2. first deterministic verification is PASS;
3. REVIEW #1 detects the intended ARCH-01 violation;
4. the finding contains concrete evidence and references ARCH-01;
5. harness accepts it as an actionable blocker;
6. zero other accepted blocking false positives;
7. exactly one review repair runs;
8. review repair changes application source only;
9. deterministic verification after repair is PASS;
10. REVIEW #2 has no unresolved accepted blocking finding;
11. workflow finishes successfully.

If the reviewer misses ARCH-01: mechanism not demonstrated.  
If it catches ARCH-01 but accepts blocking false-positive noise: review signal exists, but current reviewer/policy is not useful enough.

### Variant

```text
spec gate → implementation episode
→ [REV01] inject route-owned completeTask state transition once
→ harness npm test PASS
→ REVIEW #1
→ accepted ARCH-01 blocker
→ review repair #1 (source only)
→ npm test PASS
→ REVIEW #2 (no accepted blocker)
→ success
```

Model: same family as prior modules (`gpt-5.6-luna`). Context mode: `variant`. Architecture constraint supplied only for this probe: ARCH-01.

```bash
cd harness && npm run benchmark:rev01
```

### Results

Primary evidence after Topic Chat correction: `docs/learning/lessons/05-independent-review/traces/REV01-review-2026-08-19T17-24-41-220Z.jsonl` (+ `.spec.json`)

Earlier expected run under the later-removed correctness blanket: `REV01-review-2026-08-19T15-34-43-433Z.jsonl`

| Field                       | Value                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| spec                        | executable                                                                                                                                                  |
| impl started                | yes (no source change on green fixture)                                                                                                                     |
| first verify                | **PASS** exit 0                                                                                                                                             |
| reviewAttempts              | **2**                                                                                                                                                       |
| REVIEW #1 findings          | 1                                                                                                                                                           |
| intendedFindingDetected     | **true** (`complete-route-bypasses-task-service-transition`)                                                                                                |
| category / authority        | architecture / ARCH-01                                                                                                                                      |
| evidence                    | `completeTask` changed from `service.complete(id)` to `service.get(id)`; then `task.status = "completed"` and `task.completedAt = new Date().toISOString()` |
| acceptedBlockingFindings    | 1                                                                                                                                                           |
| acceptedNonBlockingFindings | 0                                                                                                                                                           |
| rejectedFindings            | 0                                                                                                                                                           |
| blockingFalsePositives      | **0**                                                                                                                                                       |
| reviewRepairAttempts        | **1**                                                                                                                                                       |
| review-repair changed files | `tasks/task-routes.ts` only                                                                                                                                 |
| repeatedFinding             | false                                                                                                                                                       |
| verify after repair         | **PASS** exit 0                                                                                                                                             |
| REVIEW #2                   | pass, 0 findings                                                                                                                                            |
| finalReviewerOutcome        | pass                                                                                                                                                        |
| workflow                    | **success**                                                                                                                                                 |
| model calls / tools         | 11 / 21                                                                                                                                                     |
| tokens in/out               | 28782 / 2684 (review 3515/286; review_repair 11874/1011)                                                                                                    |
| wall                        | ~43s                                                                                                                                                        |
| outcome                     | **expected**                                                                                                                                                |

Reviewer context included spec, diff, ARCH-01, and compact passed-verification evidence. It did not include implementer conversation. Tests/spec/verifier/harness were not modified.

Final workflow `changed_files` is empty because the injected layering defect was reverted to the original fixture. That is expected; the review-repair episode diff is the evidence that review repair changed source.

### Policy iteration (not a second experiment)

First probe (`REV01-review-2026-08-19T15-31-34-772Z`): REVIEW #1 detected ARCH-01 **and** restated the same defect as `correctness` / spec_requirement. Harness accepted both as blockers (`blocking_fp=1`) → decision rule UNEXPECTED, even though repair still succeeded.

That run is useful evidence of duplicate/misclassified reviewer output. It does **not** justify demoting every correctness finding after deterministic PASS.

Corrected policy after Topic Chat:

- deterministic verification is authoritative only for the checks it actually encodes;
- reviewer findings must not merely contradict passed deterministic evidence without new evidence;
- reviewer may still identify uncovered correctness problems;
- architecture/layering issues must not be restated as correctness/spec violations (reviewer instruction, not a category blanket).

REV01 was rerun with that policy (`REV01-review-2026-08-19T17-24-41-220Z`): one architecture blocker, zero blocking FPs, decision rule **expected**.

### Failures / unexpected behavior

None against the REV01 success criteria on the recorded expected run.

### Conclusion

Hypothesis supported **for this controlled defect**:

```text
deterministic PASS on an architectural defect tests do not encode
→ independent REVIEW #1 detects ARCH-01 with concrete evidence
→ harness accepts exactly one blocker
→ one review repair of application source
→ deterministic PASS
→ REVIEW #2 clean
→ workflow success
```

This does **not** prove that V3 will catch naturally occurring architecture misses, that T01–T04 remain unchanged, or that a reviewer without an explicit ARCH-01 constraint would find the same defect.

Module 05 experiment recorded; later formally closed by Master. Finding aggregation was deferred to Module 06.

---

## Module 06 — Tracing & Evals (fixed-suite measurement layer)

### Hypothesis

A small normalized measurement layer over existing V3 `HarnessRunResult` can compare the fixed suite without mixing capability regression with controlled probes, and without treating correct T04 escalation as failure.

### What this experiment is

Normalization + aggregation over the existing V3 suite:

- T01–T04: `capability_regression`
- R01: `mechanism_probe` / `verification_repair`
- REV01: `mechanism_probe` / `independent_review_repair`

Not a new tracing system, dashboard, grader farm, or reviewer-quality study.

### Variant

```text
HarnessRunResult
→ normalizeRun (taskId + runId + existing graders)
→ RunMetrics
→ aggregateRuns
→ EvalResult / compact report
```

Raw JSONL traces remain. Command:

```bash
cd harness && npm run benchmark:eval
```

Model/context: same family as prior modules (`gpt-5.6-luna`), `contextMode=variant`.

### Decision rule

Hard correctness regression if any of:

- T01–T03 expected outcome fails;
- T04 no longer escalates before implementation;
- known escaped defect appears (only if independent ground truth exists);
- R01 or REV01 mechanism contract fails.

Not hard regressions: more tokens/calls/time, a first-pass task needing bounded repair, more rejected findings, a recurring finding candidate.

### Results

Evidence:

- report: `docs/learning/lessons/06-tracing-evals/traces/2026-08-20T12-19-39-403Z.txt`
- normalized JSON: `docs/learning/lessons/06-tracing-evals/traces/2026-08-20T12-19-39-403Z.json`
- raw traces in the same folder

```text
Capability / Regression
Expected outcomes      4 / 4
Executable tasks        3
First-pass success     3 / 3
Eventual success       3 / 3
Recovered success      0 / 3
Correct escalations    1 / 1
Autonomous completion  3 / 4
Human escalation       1 / 4
Known escaped defects   n/a (grader = harness VERIFY)

Mechanism probes
R01 verification repair      PASS
REV01 independent review     PASS

All fixed benchmark contracts  6 / 6
Hard regressions: none
Diagnostics: none
```

| Task  | Kind       | expected | first-pass | verify    | model/tools | tokens in/out | wall |
| ----- | ---------- | -------- | ---------- | --------- | ----------- | ------------- | ---- |
| T01   | capability | yes      | yes        | PASS      | 7 / 15      | 18732 / 1881  | ~26s |
| T02   | capability | yes      | yes        | PASS      | 7 / 14      | 16097 / 1640  | ~25s |
| T03   | capability | yes      | yes        | PASS      | 7 / 15      | 18943 / 1534  | ~25s |
| T04   | capability | yes      | n/a        | n/a       | 2 / 7       | 4444 / 909    | ~12s |
| R01   | probe      | yes      | no         | FAIL→PASS | 11 / 23     | 30384 / 2105  | ~35s |
| REV01 | probe      | yes      | no         | PASS→PASS | 10 / 20     | 25801 / 2561  | ~36s |

T04: `expectedOutcomeMet=true`, `autonomousCompletion=false`, `humanEscalation=true`, first-pass/eventual/recovered = `null`.

R01: controlled FAIL triggered, one verification repair, then PASS. Excluded from capability first-pass.

REV01: first VERIFY PASS, intended ARCH-01 detected, unexpected blocking=0, one review repair, VERIFY PASS with **zero verification repairs**, REVIEW #2 pass. Canonical `verificationAttempts=2`, sequence `[PASS, PASS]`. `firstPassSuccess=false` because review repair is harness recovery; this is not a capability first-pass miss.

Topic Chat review tightened two semantics: REV01 fails if review repair is rescued by verification repair (PASS→FAIL→PASS); recurring findings are keyed by `findingKey` + `category`.

### Failures / unexpected behavior

None against the Module 06 decision rule.

### Conclusion

Hypothesis supported for this suite:

- capability and mechanism-probe numbers stay separated;
- T04 escalation is scored as expected outcome, not failure;
- probe recovery is not mixed into natural first-pass;
- reviewer accepted/rejected findings are not auto-claimed as precision;
- `escapedDefect` stays unknown rather than false.

This does **not** prove long-run regression trends, reviewer precision, or escaped-defect detection beyond the current shared `npm test` grader.

Module 06 experiment recorded; later formally closed by Master.

---

## Module 07 — Skills (shared evidence-guided repair)

### Hypothesis

Shared evidence-guided repair procedure can be extracted from two role-specific instruction blocks into one reusable Skill, loaded only for applicable repair episodes, while preserving R01/REV01 behavior and existing harness authority boundaries.

### Baseline

Module 06 fixed suite (`fixed-v3-m06`, 2026-08-20):

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed contracts         6 / 6
```

| Task  | Kind       | expected | first-pass | verify    | model/tools | tokens in/out | wall |
| ----- | ---------- | -------- | ---------- | --------- | ----------- | ------------- | ---- |
| T01   | capability | yes      | yes        | PASS      | 7 / 15      | 18732 / 1881  | ~26s |
| T02   | capability | yes      | yes        | PASS      | 7 / 14      | 16097 / 1640  | ~25s |
| T03   | capability | yes      | yes        | PASS      | 7 / 15      | 18943 / 1534  | ~25s |
| T04   | capability | yes      | n/a        | n/a       | 2 / 7       | 4444 / 909    | ~12s |
| R01   | probe      | yes      | no         | FAIL→PASS | 11 / 23     | 30384 / 2105  | ~35s |
| REV01 | probe      | yes      | no         | PASS→PASS | 10 / 20     | 25801 / 2561  | ~36s |

### What this experiment is

The smallest real Skills mechanism on unchanged V3 control flow:

- one procedural skill: `evidence-guided-repair`;
- deterministic phase → skill mapping;
- skill injected as labeled procedural context, not as privileged role instructions;
- observability via `skill_loaded` / `skillLoads`.

Not a skill marketplace, semantic router, or extra repair policy.

### Variant

```text
implementation → no skill
repair         → evidence-guided-repair
review_repair  → evidence-guided-repair
reviewer       → no skill
```

Command:

```bash
cd harness && npm run benchmark:eval
```

Model/context: same family as prior modules (`gpt-5.6-luna`), `contextMode=variant`. Suite label: `fixed-v3-m07`.

### Decision rule

Hard correctness regression if any of:

- T01–T03 expected outcome fails;
- T04 no longer escalates before implementation;
- R01 or REV01 mechanism contract fails.

Not hard regressions: token/call/time movement without an obvious major regression; unexpected skill disclosure is a diagnostic, not a 6/6 contract failure. Progressive disclosure is judged from traces, not only from final PASS.

### Results

Evidence:

- report: `docs/learning/lessons/07-skills/traces/2026-08-21T11-14-29-911Z.txt`
- normalized JSON: `docs/learning/lessons/07-skills/traces/2026-08-21T11-14-29-911Z.json`
- raw traces in the same folder

```text
Capability / Regression
Expected outcomes      4 / 4
Executable tasks        3
First-pass success     3 / 3
Eventual success       3 / 3
Recovered success      0 / 3
Correct escalations    1 / 1
Autonomous completion  3 / 4
Human escalation       1 / 4
Known escaped defects   n/a (grader = harness VERIFY)

Mechanism probes
R01 verification repair      PASS
REV01 independent review     PASS

Skills
T01–T04  (none)
R01      evidence-guided-repair@repair
REV01    evidence-guided-repair@review_repair
hash     efa5e14d5382c9108bd40dc471d62627bea07bb28b3676b4b523428d0dc29a25
         (identical on R01 and REV01)

All fixed benchmark contracts  6 / 6
Hard regressions: none
Diagnostics: none
```

| Task  | Kind       | expected | first-pass | verify    | model/tools | tokens in/out | wall | skill         |
| ----- | ---------- | -------- | ---------- | --------- | ----------- | ------------- | ---- | ------------- |
| T01   | capability | yes      | yes        | PASS      | 7 / 15      | 19871 / 1806  | ~32s | none          |
| T02   | capability | yes      | yes        | PASS      | 7 / 13      | 16372 / 1783  | ~28s | none          |
| T03   | capability | yes      | yes        | PASS      | 7 / 17      | 19331 / 1519  | ~25s | none          |
| T04   | capability | yes      | n/a        | n/a       | 2 / 7       | 4445 / 835    | ~11s | none          |
| R01   | probe      | yes      | no         | FAIL→PASS | 10 / 21     | 27703 / 2140  | ~34s | repair        |
| REV01 | probe      | yes      | no         | PASS→PASS | 11 / 21     | 28903 / 2789  | ~39s | review_repair |

Trace-level progressive disclosure:

- T01–T04 jsonl contain no `skill_loaded` event;
- R01: `repair_started` then `skill_loaded` with `phase=repair`; implementation and later reviewer did not load the skill;
- REV01: `review_repair_started` then `skill_loaded` with `phase=review_repair`; `implementation_started` and both `review_started` rounds have no skill event.

Efficiency vs Module 06: no obvious major regression. T01 wall +~6s / input +~1.1k; REV01 input +~3.1k is consistent with injecting the skill only on review_repair. R01 was slightly cheaper on this run (10/21 vs 11/23 model/tools).

### Failures / unexpected behavior

None against the Module 07 decision rule.

### Conclusion

Hypothesis supported for this suite:

- shared repair procedure can live in one Skill used by two distinct episode roles;
- progressive disclosure held: capability/spec episodes did not receive the repair skill;
- R01/REV01 contracts remained 6/6;
- harness still owns VERIFY, review acceptance, retry bounds, and tool permissions.

This does **not** prove that more skills, model-selected routing, or a catalog would help. One repeated procedure was enough to test the abstraction.

Module 07 experiment recorded; later formally closed by Master.

---

## Module 08 — Worktrees / Isolation (ISO01 mechanism probe + V3 regression)

### Hypothesis

A minimal per-run Git worktree can give two runs from the same exact base SHA independent mutable source state, bind existing V3 tools/verifier to that workspace, and leave the main checkout unpolluted — without changing V3 lifecycle or capability scoring.

### What this experiment is

Two separate evidence classes:

1. **ISO01** — deterministic isolation mechanism probe, no LLM.
2. **V3 regression** — existing fixed contracts T01–T04, R01, REV01 after isolation is integrated.

ISO01 is classified as `mechanism_probe` / `workspace_isolation`. It is reported under Isolation and is not part of capability first-pass or task-success denominators. V3 contracts remain 6/6.

### What this experiment is not

- Not a security/sandbox study
- Not parallel LLM agents
- Not a worktree platform, scheduler, or environment orchestrator
- Not a claim that isolation improved model quality

### Variant

```text
resolve C0
→ worktree A from C0
→ worktree B from C0
→ mutate only A (getTask 404 → 500)
→ verifier(A) FAIL, verifier(B) PASS
→ main checkout unchanged
→ explicit cleanup, retry-safe

then:
T01–T04 / R01 / REV01 each get their own workspace
→ fixture/setup inside that workspace
→ existing V3 unchanged
→ traces/evals on the host checkout
```

Commands:

```bash
cd harness && npm test
cd harness && npm run benchmark:iso01
cd harness && npm run benchmark:eval
```

Model/context for V3 runs: same family as prior modules (`gpt-5.6-luna`), `contextMode=variant`. Suite label: `fixed-v3-m08`.

### Decision rule

Isolation mechanism is supported only if all are true:

1. A and B record the same exact base SHA;
2. A observes the controlled mutation; B does not;
3. the main checkout is not polluted;
4. agent/tool paths bind to the intended workspace;
5. deterministic verification runs against the intended workspace with an observable PASS/FAIL difference;
6. cleanup is explicit and safe to retry;
7. existing V3 fixed contracts do not regress.

### Results

Evidence:

- isolation: `docs/learning/lessons/08-worktrees-isolation/traces/ISO01-isolation-2026-08-23T11-06-42-372Z.json`
- report: `docs/learning/lessons/08-worktrees-isolation/traces/2026-08-23T11-09-29-281Z.txt`
- normalized JSON: `docs/learning/lessons/08-worktrees-isolation/traces/2026-08-23T11-09-29-281Z.json`
- raw V3 traces in the same folder

```text
Isolation
ISO01 workspace isolation    PASS
C0                           e5d77788c5ac69ebca6336447156ae292e4a4029
A and B base SHA             both C0
initially equivalent         yes
A mutation / B isolated      yes / yes
main checkout unchanged      yes
verifier A / B               FAIL / PASS
cleanup / retry-safe         yes / yes

Capability / Regression
Expected outcomes      4 / 4
Executable first-pass  3 / 3
Correct escalation T04 1 / 1
R01 verification repair      PASS
REV01 independent review     PASS
All fixed V3 contracts       6 / 6
Hard regressions             none
```

ISO01 verifier binding is observable, not just cwd: A failed `returns 404 when the task does not exist` with `500 !== 404` inside `.worktrees/ISO01-A-…/target-app`; B passed the same suite.

T01 `run_started` recorded:

```text
repoRoot      .worktrees/T01-variant-…
targetAppRoot .worktrees/T01-variant-…/target-app
baseRevision  e5d77788c5ac69ebca6336447156ae292e4a4029
```

| Task  | Kind       | expected | first-pass | verify    | model/tools | tokens in/out | wall |
| ----- | ---------- | -------- | ---------- | --------- | ----------- | ------------- | ---- |
| T01   | capability | yes      | yes        | PASS      | 7 / 14      | 19296 / 1794  | ~28s |
| T02   | capability | yes      | yes        | PASS      | 7 / 15      | 19115 / 1774  | ~28s |
| T03   | capability | yes      | yes        | PASS      | 7 / 15      | 19512 / 1589  | ~25s |
| T04   | capability | yes      | n/a        | n/a       | 2 / 7       | 4444 / 900    | ~13s |
| R01   | probe      | yes      | no         | FAIL→PASS | 10 / 20     | 29203 / 2071  | ~31s |
| REV01 | probe      | yes      | no         | PASS→PASS | 11 / 21     | 30218 / 2616  | ~37s |
| ISO01 | isolation  | yes      | n/a        | FAIL/PASS | 0 / 0       | n/a           | ~2s  |

Capability denominators stayed T01–T04 / T01–T03. ISO01 did not enter first-pass or all-fixed-contracts 6/6.

Efficiency vs Module 07: no obvious major regression. Small token/wall movement is consistent with run noise plus worktree create/cleanup overhead, not a V3 behavior change.

### Failures / unexpected behavior

None against the Module 08 decision rule.

Practical constraint: worktrees do not include `node_modules`, so isolated `npm test` uses a symlink to the host `target-app/node_modules`. Source state is isolated; dependency install is not.

### Conclusion

Hypothesis supported for this suite:

- two workspaces from one exact SHA have independent mutable source;
- the existing verifier observes that independence as FAIL vs PASS;
- the main checkout is not the mutable task workspace;
- V3 contracts remain 6/6 after isolation is integrated;
- ISO01 is scored as isolation evidence, not capability.

This does **not** prove security isolation, parallel agent safety, or that a generic workspace platform is needed.

Module 08 experiment recorded; later formally closed by Master.

---

## Module 09 — Security fundamentals (SEC01 mechanism probe + V3 regression)

### Hypothesis

A positive/minimal environment allowlist on the shared verification spawn can stop parent harness secrets from being inherited by repository code executed through `npm test`, without building a general sandbox and without changing V3 capability scoring.

### What this experiment is

Two separate evidence classes:

1. **SEC01** — deterministic verification-secret-isolation probe, no LLM.
2. **V3 regression** — existing fixed contracts T01–T04, R01, REV01, plus ISO01, after the env allowlist is the only verification child environment.

SEC01 is classified as `mechanism_probe` / `verification_secret_isolation`. It is reported under Security and is not part of capability first-pass or task-success denominators. V3 contracts remain 6/6.

### What this experiment is not

- Not a filesystem, network, or process sandbox study
- Not a claim that worktrees became a security boundary
- Not a secret manager, IAM, or container platform
- Not a capability benchmark task

### Variant

```text
parent process has SEC01_SECRET
→ isolated worktree
→ inject probe into target-app/src/app.ts
→ real npm test via runFinalVerification
   ├─ emit SEC01_PROBE_EXECUTED
   ├─ fail with SEC01_SECRET_VISIBLE if sentinel is visible
   └─ never print the sentinel value
→ child must not observe SEC01_SECRET
→ verification PASS
→ main checkout unchanged
→ cleanup

then:
T01–T04 / R01 / REV01 / ISO01
→ existing V3 + isolation contracts
→ traces/evals on the host checkout
```

Shared enforcement:

```text
verificationChildEnv() + spawnNpmTest()
→ run_command("npm test")
→ runFinalVerification()
```

Commands:

```bash
cd harness && npm test
cd harness && npm run benchmark:sec01
cd harness && npm run benchmark:iso01
cd harness && npm run benchmark:eval
```

Model/context for V3 runs: same family as prior modules (`gpt-5.6-luna`), `contextMode=variant`. Suite label: `fixed-v3-m09`.

### Decision rule

Secret isolation is supported only if all are true:

1. the parent process contains `SEC01_SECRET`;
2. controlled repository code was actually executed;
3. the child cannot observe `SEC01_SECRET`;
4. verification succeeds;
5. the raw sentinel value does not appear in captured output/evidence;
6. the main checkout remains unchanged;
7. workspace cleanup succeeds;
8. existing V3 fixed contracts and ISO01 do not regress.

A SEC01 miss is a security regression, not an ordinary task failure.

### Results

Evidence:

- security: `docs/learning/lessons/09-security-fundamentals/traces/SEC01-secret-isolation-2026-08-24T12-49-32-810Z.json`
- report: `docs/learning/lessons/09-security-fundamentals/traces/2026-08-24T12-52-23-876Z.txt`
- normalized JSON: `docs/learning/lessons/09-security-fundamentals/traces/2026-08-24T12-52-23-876Z.json`
- raw V3 traces in the same folder

```text
Security
SEC01 verification secret isolation  PASS
parent contained sentinel            yes
probe executed                       yes
secret visible to child              no
verification                         PASS
sentinel absent from evidence        yes
main checkout unchanged              yes
cleanup / retry-safe                 yes / yes

Isolation
ISO01 workspace isolation            PASS

Capability / Regression
Expected outcomes      4 / 4
Executable first-pass  3 / 3
Correct escalation T04 1 / 1
R01 verification repair      PASS
REV01 independent review     PASS
All fixed V3 contracts       6 / 6
Hard regressions             none
```

SEC01 verifier output contains `SEC01_PROBE_EXECUTED` and passing target-app tests. It does not contain the sentinel value.

| Task  | Kind       | expected | first-pass | verify    | model/tools | tokens in/out | wall |
| ----- | ---------- | -------- | ---------- | --------- | ----------- | ------------- | ---- |
| T01   | capability | yes      | yes        | PASS      | 8 / 13      | 21115 / 1860  | ~30s |
| T02   | capability | yes      | yes        | PASS      | 7 / 14      | 15915 / 1446  | ~23s |
| T03   | capability | yes      | yes        | PASS      | 7 / 16      | 20034 / 1642  | ~24s |
| T04   | capability | yes      | n/a        | n/a       | 3 / 8       | 7979 / 868    | ~13s |
| R01   | probe      | yes      | no         | FAIL→PASS | 10 / 22     | 29695 / 2080  | ~38s |
| REV01 | probe      | yes      | no         | PASS→PASS | 11 / 21     | 28140 / 2660  | ~39s |
| ISO01 | isolation  | yes      | n/a        | FAIL/PASS | 0 / 0       | n/a           | ~2s  |
| SEC01 | security   | yes      | n/a        | PASS      | 0 / 0       | n/a           | ~1s  |

Capability denominators stayed T01–T04 / T01–T03. SEC01 did not enter first-pass or all-fixed-contracts 6/6.

### Failures / unexpected behavior

None against the Module 09 decision rule.

Harness unit tests: 86 passed, including allowlist tests, SEC01, ISO01, and eval semantics.

### Conclusion

Hypothesis supported for this suite:

- verification execution no longer inherits unrelated parent secrets;
- one allowlist/spawn boundary covers both `run_command` and harness VERIFY;
- SEC01 makes the property observable without relying on the model;
- V3 contracts remain 6/6; ISO01 remains PASS;
- SEC01 is scored as security evidence, not capability.

This does **not** prove host filesystem containment, network containment, subprocess containment, or a sandbox for arbitrary hostile repositories.

Module 09 experiment recorded; formal module closure still pending Topic Chat review.

---

## Module 10 — Model Routing (repair-only override)

### Hypothesis

An explicit, deterministic phase→model resolver can route only the bounded verification-repair episode onto a stronger model, without changing tools, VERIFY, review, repair bounds, or other authority — and a controlled R01 comparison can show whether Terra is worth the extra cost on that episode, or whether Luna is already sufficient.

No assumption that heterogeneous routing must win. "No routing justified by evidence" is a valid result.

### Chosen routing axis

Deterministic `phase` / semantic episode. Not task-class, not LLM-selected, not complexity prediction.

### Why repair first

R01 is already a controlled FAIL→repair→PASS probe with normalized failure evidence and a fixed quality contract. It isolates the repair episode better than a whole-workflow Luna-vs-Terra comparison.

### Baseline

```text
OPENAI_MODEL=gpt-5.6-luna
OPENAI_REPAIR_MODEL absent
→ spec / implementation / repair / review / review_repair all use Luna
```

3 independent valid R01 trials.

### Variant

```text
OPENAI_MODEL=gpt-5.6-luna
OPENAI_REPAIR_MODEL=gpt-5.6-terra
→ spec / implementation / review / review_repair: Luna
→ repair: Terra
```

3 independent valid R01 trials. Not Luna-everywhere vs Terra-everywhere.

### Quality SLO (defined before the experiment)

For each model: 3 independent valid R01 repair trials.

A model meets the SLO only if **all** 3/3 valid trials satisfy the existing R01 repair contract:

- exactly one bounded verification-repair episode;
- first verification FAIL;
- next verification PASS;
- final verification PASS;
- no repeated failure;
- workflow success;
- repair changes only allowed source scope;
- no modification of tests/spec/verify/harness artifacts by the repair.

### Controlled variables

Same R01 task, green fixture, workspace isolation, deterministic 404→500 fault, VERIFY, repair bounds, tools, prompts, and review path. Only the repair-episode model differs.

### Trial-validity rule

A trial counts for the repair comparison only if:

1. R01 controlled fault was injected;
2. first post-injection VERIFY is FAIL;
3. normalized failure exists;
4. failure matches the intended R01 404→500 defect;
5. the repair episode actually starts.

Otherwise the trial is contaminated, not a model-quality failure, and is replaced until 3 valid trials exist (cap 6 attempts/arm).

### Measurements

Per valid trial: repair model / routing reason / phase; R01 expectedOutcomeMet; first/second verify; repair success; workflow success; repeated failure; repair/verification attempts; repair model/tool calls, tokens, wall time; whole-workflow calls/tokens/wall time when available. No fabricated tokens. No hardcoded monetary pricing.

### Results

Command: `cd harness && npm run benchmark:routing`

Evidence:

- report: `docs/learning/lessons/10-model-routing/traces/routing-m10-2026-08-25T10-54-03-280Z.txt`
- json: `docs/learning/lessons/10-model-routing/traces/routing-m10-2026-08-25T10-54-03-280Z.json`
- raw trial traces in the same folder

Contaminated trials: **none** (3/3 attempted valid on both arms).

#### BASELINE — Luna repair

| Trial | expected    | verify    | repair calls/tools | repair tokens in/out | repair ms | workflow calls | workflow tokens in/out | wall ms |
| ----- | ----------- | --------- | ------------------ | -------------------- | --------- | -------------- | ---------------------- | ------- |
| 1     | yes         | FAIL→PASS | 4 / 6              | 14911 / 1030         | 13761     | 10             | 26864 / 2017           | 34930   |
| 2     | yes         | FAIL→PASS | 4 / 7              | 18422 / 1032         | 11240     | 10             | 31184 / 2144           | 29300   |
| 3     | yes         | FAIL→PASS | 4 / 6              | 18058 / 1031         | 11687     | 10             | 30362 / 2078           | 29496   |
| avg   | 3/3 SLO MET |           | 4 / 6              | 17130 / 1031         | 12229     | 10             | 29470 / 2080           | 31242   |

Routing: `phase=repair`, `model=gpt-5.6-luna`, `reason=default`.

#### VARIANT — Terra repair

| Trial | expected    | verify    | repair calls/tools | repair tokens in/out | repair ms | workflow calls | workflow tokens in/out | wall ms |
| ----- | ----------- | --------- | ------------------ | -------------------- | --------- | -------------- | ---------------------- | ------- |
| 1     | yes         | FAIL→PASS | 4 / 7              | 18281 / 1017         | 10983     | 11             | 33828 / 2079           | 31332   |
| 2     | yes         | FAIL→PASS | 4 / 7              | 18291 / 1016         | 10173     | 10             | 30739 / 2122           | 31544   |
| 3     | yes         | FAIL→PASS | 4 / 6              | 15191 / 994          | 10460     | 10             | 29321 / 2064           | 28578   |
| avg   | 3/3 SLO MET |           | 4 / 7              | 17254 / 1009         | 10539     | 10             | 31296 / 2088           | 30485   |

Routing: `phase=repair`, `model=gpt-5.6-terra`, `reason=repair_override`. Spec/implementation/review stayed on Luna.

### Predefined decision rule (not applied by this report)

1. Luna 3/3, Terra 3/3: compare efficiency. Stronger routing is justified only if Terra provides a meaningful reliability/latency/workflow benefit that offsets its substantially higher token price.
2. Luna <3/3, Terra 3/3: `repair → Terra` becomes an evidence-supported routing candidate.
3. both <3/3: do not conclude routing solves the problem.
4. noisy / insufficient evidence: no permanent routing decision.

Observed against that rule: **both 3/3**. Quality did not separate the models on this probe. Repair token counts were similar; Terra repair wall time was slightly lower on this sample (~10.5s vs ~12.2s). This report does **not** select a permanent routing policy.

### Fixed regression (kept separate from routing trials)

`docs/learning/lessons/10-model-routing/traces/2026-08-25T11-00-45-136Z.txt`  
Suite label remains `fixed-v3-m09`.

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed V3 contracts      6 / 6
ISO01                       PASS
SEC01                       PASS
Hard regressions            none
```

| Task  | Kind       | expected | first-pass | verify    | model/tools | tokens in/out | wall |
| ----- | ---------- | -------- | ---------- | --------- | ----------- | ------------- | ---- |
| T01   | capability | yes      | yes        | PASS      | 7 / 13      | 19003 / 1863  | ~25s |
| T02   | capability | yes      | yes        | PASS      | 8 / 15      | 18563 / 1775  | ~28s |
| T03   | capability | yes      | yes        | PASS      | 7 / 14      | 18729 / 1477  | ~29s |
| T04   | capability | yes      | n/a        | n/a       | 2 / 7       | 4444 / 925    | ~20s |
| R01   | probe      | yes      | no         | FAIL→PASS | 10 / 21     | 32599 / 2196  | ~38s |
| REV01 | probe      | yes      | no         | PASS→PASS | 11 / 21     | 29126 / 2539  | ~51s |

Routing comparison runs were not added to this 6/6 denominator.

Harness unit tests: 94 passed.

### Failures / unexpected behavior

None against the routing mechanism or R01 validity rule. No contaminated trials. Variant trial 1 used 11 whole-workflow model calls instead of 10 (one extra non-repair turn); repair-episode call count stayed at 4.

### Conclusion

Hypothesis about the **mechanism** is supported: one explicit resolver can change only the repair model, leave `review_repair` on the default, and keep existing V3 contracts at 6/6.

On this R01 probe, both Luna and Terra met the predefined quality SLO 3/3. That is rule (1): efficiency comparison is available; it is **not** an automatic decision to keep or drop the Terra override.

This does **not** prove routing helps on naturally occurring repairs, other episodes, or other models.

Module 10 experiment recorded; formal module closure and any permanent routing policy remain for Topic Chat.

---

## Module 11 — Modern model-native orchestration (inner vs outer loop)

### Hypothesis

Using `previous_response_id` instead of manual full Responses-history replay inside a bounded agent episode can preserve correctness, security and outer workflow semantics while reducing client-owned conversation-state plumbing/replay.

This is **not** a test of reducing model calls. Custom tools remain client-owned.

### Baseline

ARM A: `conversationStateMode = manual` (current V3 loop).

```text
task
→ response A
→ append response.output
→ execute local tools
→ append function_call_output
→ send the complete accumulated input again
```

### Variant

ARM B: `conversationStateMode = previous_response_id`, **inside `runAgentLoop` only**.

```text
first call: input = task, previous_response_id = undefined
→ execute local tools
next call: previous_response_id = A.id, input = ONLY new function_call_output items
→ repeat
```

Each `runAgentLoop` invocation starts a fresh chain. Implementation, repair, and review_repair are not chained together.

### Controlled variables

T02, `contextMode=variant`, same fixture, model/routing, maxTurns, instructions, tools, security, spec gate, verifier, review/repair policies. Isolated worktree per trial.

Only conversation-state **transport** differs.

Command: `cd harness && npm run benchmark:orchestration`

### Metrics

Per trial: expected outcome, workflow status, final VERIFY, model/tool calls, implementation turns, `clientInputItemsSent`, `clientInputBytesSent` (UTF-8 `JSON.stringify(input)` only — not instructions/tools), tokens, wall time, changed files, conversation-state mode, chain evidence.

### Results (3×3 T02)

Evidence:

- report: `docs/learning/lessons/11-modern-model-native-orchestration/traces/orchestration-m11-2026-08-26T11-33-10-801Z.txt`
- json: `docs/learning/lessons/11-modern-model-native-orchestration/traces/orchestration-m11-2026-08-26T11-33-10-801Z.json`
- raw trial traces in the same folder

#### ARM A — manual

| Trial | expected | workflow | verify | calls/tools | impl turns | client items/bytes | tokens in/out | wall | files             |
| ----- | -------- | -------- | ------ | ----------- | ---------- | ------------------ | ------------- | ---- | ----------------- |
| 1     | yes      | success  | PASS   | 7 / 15      | 4          | 45 / 50929         | 16418 / 1443  | ~24s | `task-service.ts` |
| 2     | yes      | success  | PASS   | 7 / 15      | 4          | 45 / 51254         | 16680 / 1623  | ~24s | `task-service.ts` |
| 3     | yes      | success  | PASS   | 7 / 14      | 4          | 39 / 57863         | 18436 / 1643  | ~23s | `task-service.ts` |
| avg   | 3/3      |          |        | 7 / 15      | 4          | 43 / 53349         | 17178 / 1570  | ~24s |                   |

Chain: every implementation turn has `previousResponseId=null`; client item counts grow `1 → 12 → 15 → 17`.

#### ARM B — previous_response_id

| Trial | expected | workflow | verify | calls/tools | impl turns | client items/bytes | tokens in/out | wall | files             |
| ----- | -------- | -------- | ------ | ----------- | ---------- | ------------------ | ------------- | ---- | ----------------- |
| 1     | yes      | success  | PASS   | 7 / 14      | 4          | 7 / 14049          | 18394 / 1768  | ~27s | `task-service.ts` |
| 2     | yes      | success  | PASS   | 8 / 14      | 4          | 7 / 14277          | 22043 / 1998  | ~30s | `task-service.ts` |
| 3     | yes      | success  | PASS   | 7 / 15      | 4          | 8 / 14618          | 19055 / 1898  | ~40s | `task-service.ts` |
| avg   | 3/3      |          |        | 7 / 14      | 4          | 7 / 14315          | 19831 / 1888  | ~32s |                   |

Chain example (trial 1):

```text
turn1 previous=null  → resp_A  items=1
turn2 previous=A     → resp_B  items=4
turn3 previous=B     → resp_C  items=1
turn4 previous=C     → resp_D  items=1
```

### Decision rule

| Criterion                                             | Result                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| 1. previous_response_id 3/3 correct on T02            | yes                                                                     |
| 2. Client-side full-history replay gone in variant    | yes                                                                     |
| 3. Tool/workspace/security authority unchanged        | yes (by construction + unit tests)                                      |
| 4. Tool-call observability intact                     | yes                                                                     |
| 5. Client items/bytes materially decrease             | yes (43→7 items, 53KB→14KB)                                             |
| 6. No clear repeated token/latency/failure regression | **inconclusive** (n=3; tokens +15%, wall +37%; no predefined threshold) |

**Candidate to adopt: no.** Keep baseline.

### Fixed regression (variant-mode suite, not a default change)

The suite below was run with `conversationStateMode = previous_response_id` after the 3×3. It shows the variant can pass V3; it does not change the default.

`docs/learning/lessons/11-modern-model-native-orchestration/traces/2026-08-26T11-39-08-076Z.txt`  
Suite label remains `fixed-v3-m09`.

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed V3 contracts      6 / 6
ISO01                       PASS
SEC01                       PASS
Hard regressions            none
```

| Task  | Kind       | expected | first-pass | verify    | model/tools | tokens in/out | wall |
| ----- | ---------- | -------- | ---------- | --------- | ----------- | ------------- | ---- |
| T01   | capability | yes      | yes        | PASS      | 7 / 15      | 19658 / 1813  | ~25s |
| T02   | capability | yes      | yes        | PASS      | 8 / 14      | 19320 / 1416  | ~30s |
| T03   | capability | yes      | yes        | PASS      | 7 / 16      | 19579 / 1567  | ~29s |
| T04   | capability | yes      | n/a        | n/a       | 2 / 7       | 4444 / 845    | ~10s |
| R01   | probe      | yes      | no         | FAIL→PASS | 10 / 20     | 29325 / 2110  | ~31s |
| REV01 | probe      | yes      | no         | PASS→PASS | 11 / 22     | 31156 / 2518  | ~34s |

Harness unit tests: 104 passed.

### Failures / unexpected behavior

- Provider **input tokens did not fall** with client replay. Client items/bytes dropped sharply; billed input tokens were slightly higher on the variant arm (~17.2k → ~19.8k). Server-side continuation still counts conversation tokens; traces show `cached_tokens` growing across the chain.
- Variant wall time was higher on this n=3 sample (~32s vs ~24s). Criterion 6 is inconclusive; do not invent a pass/fail bar after the run.
- Variant trial 2 used 8 whole-workflow model calls instead of 7 (one extra non-impl turn). Implementation turns stayed at 4.

### Conclusion

Hypothesis supported for **client conversation-state plumbing**, not as a token-cost optimization, and **not as a default change**.

- T02 correctness 3/3 on both arms.
- Variant traces show `previous_response_id` chaining and no manual `response.output` replay.
- Outer VERIFY / repair / review / workspace / security / eval scoring unchanged.
- Custom tools still go through `executeTool()`.
- Fixed V3 suite remained 6/6 **when the variant was selected**.
- Criterion 6 remains inconclusive on n=3.

**Decision: keep baseline.** Default `conversationStateMode` stays `manual`. `previous_response_id` remains fully implemented and selectable via `--previous-response-id`. Topic Chat still owns formal module closure.

This does **not** prove Sessions/Conversations API, PTC, hosted shell, MCP, or subagents would help. Those remain out of scope.

Module 11 experiment recorded; formal module closure remains for Topic Chat. Do not treat `theory.md` as written yet.
