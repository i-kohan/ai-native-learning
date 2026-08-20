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

- report: `docs/learning/lessons/06-tracing-evals/traces/2026-08-20T11-39-01-776Z.txt`
- normalized JSON: `docs/learning/lessons/06-tracing-evals/traces/2026-08-20T11-39-01-776Z.json`
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

| Task | Kind | expected | first-pass | verify | model/tools | tokens in/out | wall |
| ---- | ---- | -------- | ---------- | ------ | ----------- | ------------- | ---- |
| T01  | capability | yes | yes | PASS | 7 / 11 | 15449 / 1759 | ~27s |
| T02  | capability | yes | yes | PASS | 7 / 15 | 19332 / 1686 | ~25s |
| T03  | capability | yes | yes | PASS | 7 / 15 | 19217 / 1634 | ~33s |
| T04  | capability | yes | n/a | n/a | 2 / 7 | 4445 / 847 | ~11s |
| R01  | probe | yes | no | FAIL→PASS | 10 / 19 | 28015 / 2271 | ~33s |
| REV01 | probe | yes | no | PASS→PASS | 11 / 21 | 27684 / 2633 | ~40s |

T04: `expectedOutcomeMet=true`, `autonomousCompletion=false`, `humanEscalation=true`, first-pass/eventual/recovered = `null`.

R01: controlled FAIL triggered, one verification repair, then PASS. Excluded from capability first-pass.

REV01: first VERIFY PASS, intended ARCH-01 detected, unexpected blocking=0, one review repair, VERIFY PASS, REVIEW #2 pass. Canonical `verificationAttempts=2`, sequence `[PASS, PASS]`. `firstPassSuccess=false` because review repair is harness recovery; this is not a capability first-pass miss.

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

Module 06 experiment recorded; formal module closure still pending Topic Chat / Master review.
