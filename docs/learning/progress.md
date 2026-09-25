# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering
4. ✅ 04 — Verification + bounded Repair
5. ✅ 05 — Independent Review + bounded Review Repair
6. ✅ 06 — Tracing & Evals
7. ✅ 07 — Skills
8. ✅ 08 — Worktrees / Isolation
9. ✅ 09 — Security Fundamentals
10. ✅ 10 — Model Routing
11. ✅ 11 — Modern Model-Native Orchestration / Inner vs Outer Loop
12. ✅ 12 — Planner / Worker / Reviewer
13. ✅ 13 — Subagents
14. ✅ 14 — Human-Reviewable Decomposition
15. ✅ 15 — Stronger Eval Methodology (closed by Master; see phase-3 consolidation)
16. ✅ 16 — Durable Execution (closed by Topic Chat)
17. ✅ 17 — Checkpoint / Resume (closed by Master)
18. ✅ 18 — Retry Semantics (closed by Topic Chat)
19. ✅ 19 — Orchestration as Distributed Systems (closed by Topic Chat on 2026-09-18)
20. ✅ 20 — GitHub / CI Integration (closed by Master on 2026-09-20; live GHI01 + CI01 PASS)
21. ⏭ 21 — Optional Browser QA (skipped / not applicable on current non-UI capstone; revisit only for a real UI workload)
22. ✅ 22 — Bounded Parallel Fan-Out (closed by Master on 2026-09-23; PAR01 = `not_worth_current_workload`)
23. ✅ 23 — MCP Deeper Dive (closed by Master on 2026-09-24; MCP01 PASS; default local repo read remains direct)

Next module: **24 — Memory Architectures** (implemented and measured; Topic Chat owns closure; not marked complete).

---

## Current execution core

The capstone remains **V3 Spec-Driven + targeted context + bounded verify/repair + independent review**, with later layers around it:

- systematic measurement: `HarnessRunResult → RunMetrics → EvalResult`;
- one reusable procedural Skill: `evidence-guided-repair`, selectively loaded only for `repair` / `review_repair`;
- per-run Git worktree isolation for benchmark/eval execution;
- exact workspace provenance via `baseRevision`;
- workspace-bound `repoRoot / targetAppRoot / targetSrcRoot`, so tools/context/snapshots/verifier operate on the run's workspace;
- verification children (`run_command("npm test")` and `runFinalVerification`) share one minimal env allowlist, so repository code does not inherit harness secrets such as `OPENAI_API_KEY`;
- deterministic harness-owned model routing through `resolveModel(episode, config)`; current normal policy keeps all episodes on `gpt-5.6-luna`;
- optional in-episode Responses `previous_response_id` continuation inside `runAgentLoop`; default remains manual full-history replay because the Module 11 efficiency/adoption criterion was inconclusive;
- optional explicit read-only Planner mechanism exists behind `planningEnabled`, but remains off by default because Module 12 P01 showed equal quality with worse end-to-end cost;
- optional Worker `delegate_research` exists behind `subagentsEnabled`, default `false`. Module 13 mechanism probe, not a change to the normal lifecycle;
- optional advisory ReviewPlan sequential units exist only when a binder is supplied (Module 14 experiment). Harness-owned `UnitExecutionScope` bounds each episode. Default remains one Worker;
- eval catalog now distinguishes `dev` / `holdout` / `probe` / isolation / security. H01/H02 have a host-owned independent grader that runs after the harness terminal outcome. T01–T04 still have `escapedDefect=null` because their grader is VERIFY;
- opt-in durable workflow checkpoints `spec_required → implementation_ready → review_ready` (Modules 16–17) plus harness-owned bounded REVIEW retry on `review_ready` (Module 18);
- opt-in single-machine workflow lease + fencing token for authoritative WorkflowState writes (Module 19). Default `runV1Harness()` remains in-memory unless `durable` is passed. Experimental Planner/Subagent/ReviewPlan paths are explicitly unsupported on the durable path;
- opt-in post-terminal `DeliveryState` for GitHub draft-PR delivery and exact-head CI admission (Module 20). Does not append GitHub phases to `WorkflowState`. Live GHI01 and CI01 mechanism evidence is recorded; formal closure remains with Topic Chat / Master.
- optional bounded fan-out behind an explicit `FanOutPlan` binder (Module 22). Same exact-base worktrees, schedule `sequential | parallel`, Git 3-way fan-in. Default remains Spec → one Worker; corrected PAR01 on P03 (one frozen Spec, 3×2 valid scheduling trials) was `not_worth_current_workload`.
- optional MCP repository-read mechanism behind `mcpRepoReadEnabled` (Module 23). Implementation Worker can replace direct `read_file` with Host-admitted `repo_read_file` over a real local stdio MCP boundary. Default remains direct `read_file`; MCP does not own Spec, writes, VERIFY, REVIEW, retry, or workflow success.
- optional verified repository memory behind explicit `memory` options (Module 24). Repository scope comes from the bound `config.repoRoot`. A harness-admitted implementation-surface fact can persist outside `WorkflowState` and, after current-repository validation, enter Worker context as one advisory hint. Default `runV1Harness()` does not read or write memory.

Conceptual default flow:

```text
raw task
→ isolated workspace from exact committed SHA
→ targeted context
→ read-only spec / ambiguity gate
→ implementation Worker (implicit planning)
→ deterministic VERIFY / bounded repair
→ independent REVIEW / bounded review repair
→ measured outcome
→ cleanup
```

Security note: this is still not a general sandbox; executed repository code can access host filesystem/network/subprocesses within OS account permissions.

Detailed evidence lives in `docs/learning/experiments.md` and `docs/learning/lessons/*`.

---

# Module 24 — Memory Architectures

**Status:** implemented and measured. MEM01 **PASS** as a mechanism probe. Topic Chat owns formal closure. Not marked complete. Default `runV1Harness()` does not read or write memory.

Theory:

`docs/learning/lessons/24-memory-architectures/theory.md`

Practical notes:

`docs/learning/lessons/24-memory-architectures/notes.md`

## What was implemented

Opt-in verified repository memory, separate from `WorkflowState`:

```text
verified workflow
→ harness observes the current task implementation surface
→ admit MemoryRecord
→ later fresh workflow filters by repository scope
→ validate the claim against the current tree
→ one advisory Worker hint, or reject stale and inject nothing
```

The MEM01 claim is derived from `task-routes.ts` delegating to the class it imports. On this repository that observation is `TaskService` in `target-app/src/tasks/task-service.ts`.

## Important design decisions

Model output is not an input to admission. Promotion runs only after workflow success, VERIFY PASS, and independent REVIEW `pass`.

A file fingerprint is stored as provenance. Validation checks that the source path still exists and that the same anchor still implements the delegated operations. A byte-only change does not by itself reject the claim. If the anchor cannot be re-established, validation fails closed and the stored record is not rewritten.

Memory is not a vector index, not conversation continuation, and not a workflow phase.

Repository scope is harness-owned. `runV1Harness()` derives it from the bound `config.repoRoot` with `repositoryScopeOf()`. `MemoryRunOptions` does not accept a caller scope, so a run cannot label repository B as repository A.

## Current result

Harness tests: **303 passed**, including 15 memory tests.

MEM01 (T02 promote, fresh T03 retrieve, isolated stale workspace): **PASS**. Re-run after harness-owned repository scope: **PASS**. Evidence: `docs/learning/lessons/24-memory-architectures/traces/mem01-2026-09-25T19-22-55-217Z.txt`.

T03 still called implementation `read_file` 6 times after the hint was injected. `implNavCallsBeforeFirstWrite` was 6. That is one observation, not a quality or cost claim.

## Failures / open questions

No mechanism failure on this probe. Adoption stays off: one advisory hint did not replace repository discovery, and always-on memory is outside this module.

---

# Module 23 — MCP Deeper Dive

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-24. MCP01 **PASS** as a mechanism probe. Default harness path unchanged (`mcpRepoReadEnabled` off).

Theory:

`docs/learning/lessons/23-mcp/theory.md`

Practical notes:

`docs/learning/lessons/23-mcp/notes.md`

## What was implemented

Opt-in bounded repository read across a real MCP stdio boundary:

```text
Implementation Worker
→ Host admission
→ MCP Client (pin 2026-07-28)
→ stdio
→ local server
→ repo_read_file(path)
```

The model supplies `path` only. `MCP_ALLOWED_ROOT` is host configuration. `resolveWithin()` remains the containment check. Writes, VERIFY, REVIEW, repair, and workspace ownership stay on the existing path.

## Important design decisions

Host allowlist is separate from `listTools()`. A discovered `repo_read_file` is not executable when the allowlist excludes it. Schema admission requires the expected narrow `path: string` contract with `additionalProperties: false` and rejects model-controlled root or credential arguments.

The MCP child gets the SDK safe/default inherited environment plus `MCP_ALLOWED_ROOT`. It does not receive the parent environment, including `OPENAI_API_KEY`.

Repair and review-repair are not migrated.

## Current result

Harness unit tests: **287 passed**.

MCP01 DEV run (T01, variant, one trial): implementation called `repo_read_file` twice and `write_file` once; no implementation `read_file`. VERIFY PASS. Independent REVIEW `pass`. Evidence: `docs/learning/lessons/23-mcp/traces/mcp01-t01-2026-09-24T09-05-18-835Z.txt`.

## Review / adoption decision

Topic Chat implementation review: **PASS**. No architecture or methodology blockers remain. This does not show that MCP improves model quality.

Default repository reads stay direct: one local tightly-coupled read does not justify MCP process/protocol/discovery overhead. Keep MCP as an opt-in mechanism/pattern for future reusable or externally owned capability boundaries. Final understanding check passed with two terminology corrections: MCP standardizes a broader integration surface than Tools alone, and schema validity proves structure rather than safety/authorization. Module 23 is closed. See `docs/learning/lessons/23-mcp/closure.md`.

---

# Module 22 — Bounded Parallel Fan-Out

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-23. Harness tests **278 passed**. Corrected PAR01 = **`not_worth_current_workload`**. Default remains Spec → one Worker.

Theory:

`docs/learning/lessons/22-bounded-parallel-fan-out/theory.md`

Practical notes:

`docs/learning/lessons/22-bounded-parallel-fan-out/notes.md`

## What was implemented

Bounded two-unit fan-out probe, not a generic scheduler:

- frozen `FanOutPlan` (A title mutation, B deletion) separate from ReviewPlan;
- exact-base child A / child B / integration worktrees;
- one base SHA and one Spec resolved once and reused for all six PAR01 trials; schedule `sequential | parallel`;
- harness-owned scoped VERIFY; child success is not Worker-claimed;
- real Git source deltas; deterministic A→B `git apply --3way` fan-in;
- file overlap allowed; incompatible hunks fail closed;
- final VERIFY + independent REVIEW after fan-in;
- PAR01 measurement/decision rule frozen before the 3×2.

## Important design decisions

FanOutPlan is process control. Spec stays product authority. Both units receive the full `Spec.acceptance` list (shared); unit scope is intent + test files, not keyword `owns()`.

`git apply --3way` needs index ≈ working tree. `restoreFixture` rewrites `target-app/src` on disk; apply now syncs the index first.

Admission requires exactly two units and `maxParallelWorkers === 2`. A PAR01 trial is valid only if both children actually started.

Default architecture is unchanged: Spec → one Worker. `admittedSpec` is experiment-only.

## Current result

Smoke (`benchmark:fanout:smoke`): all worktrees on one SHA.

First PAR01 (`…20-18-39-907Z`) is invalid: a fresh Spec per trial, and one sequential “valid” after Spec escalate. Do not cite 0/3 vs 2/3.

`…20-48-39-502Z` froze Spec but still resolved HEAD per trial. Authoritative PAR01 (`…21-10-55-910Z`): one frozen SHA `b65e157` + one Spec; sequential **0/3**, parallel **0/3**, median wall 56s vs 38s, parallel more expensive. Evidence: `docs/learning/lessons/22-bounded-parallel-fan-out/traces/fanout-m22-par01-2026-09-22T21-10-55-910Z.txt`.

## Failures / open questions

P03 is semantically independent but integration-coupled; children can PASS scoped VERIFY and still conflict during deterministic fan-in in `task-service.ts`. Unknown-id 404 now precedes title validation, so Spec variance is no longer a valid-trial artifact. Topic Chat closure: PASS. Revisit fan-out only when integration coupling is low and end-to-end evidence justifies it.

---

# Module 20 — GitHub / CI Integration

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-20. Deterministic contracts **passed**. Live GHI01 **PASS**. Live CI01 **PASS**.

Theory:

`docs/learning/lessons/20-github-ci-integration/theory.md`

Practical notes:

`docs/learning/lessons/20-github-ci-integration/notes.md`

## What was implemented

Linked post-terminal GitHub delivery:

- separate `DeliveryState` keyed by `workflowId`;
- deterministic `agent/<workflowId>` branch;
- intended vs observed GitHub reconciliation, no force push, no merge;
- exact-head CI admission;
- one bounded semantic CI repair with fresh VERIFY + REVIEW;
- smallest `pull_request` GitHub Actions workflow;
- experiment-only `harness/fixtures/ci01.red` CI fault.

## Important design decisions

`WorkflowState` terminal remains terminal. Durable workspace resume still assumes an uncommitted tree (`HEAD === headRevision === baseRevision`). After H1, `DeliveryState.expectedHeadSha` owns the delivery head.

`WorkflowState` fencing does not fence GitHub. Ownership is checked before privileged writes; GitHub still cannot enforce the fencing token.

## Current result

Harness unit tests: **254 passed**, including Modules 16–19 regressions and delivery contracts.

GHI01 live evidence (retained, not rerun):

- issue `#5`
- draft PR `#6`
- workflowId `GHI01-2026-09-19T18-12-22-355Z`
- baseSha `223d1111c8cca84ecc6e7d7cadcbf15ad13a7f82`
- H1 `11109909a22eaf7e87942ffc1f9e2515394f2c50`
- Actions run `35460488830` = PASS
- PR remains draft / unmerged

CI01 live evidence (2026-09-20):

- issue `#7`
- draft PR `#9`
- workflowId `CI01-2026-09-20T13-09-15-630Z`
- baseSha `86e47b48a34976b75cdd0cb8d9840af330915940`
- H1 `cbb79d7aa4d20f903e76919b0258508e6f2c4df6`
- CI(H1) run `35512678853` = FAIL
- H2 `fdc7b1ddd14ed8cc3af86eb6879fd890f7532c39`
- CI(H2) run `35512702897` = PASS
- same PR `#9` advanced H1 → H2
- `ciRepairAttempts` = 1
- final phase `ready_for_human_review`
- PR remains draft / unmerged

## Closure / remaining boundaries

Topic Chat closure: **PASS** on 2026-09-20. GHI01 proves real issue → accepted artifact → deterministic branch → draft PR → current-head green CI. CI01 proves real H1 red → bounded repair → fresh VERIFY + independent REVIEW → H2 → same PR → current-head green CI.

This remains mechanism evidence, not a broad reliability qualification. GitHub polling, one repair maximum, and the residual ownership check → external-action race remain explicit boundaries. Master owns next-module selection.

---

# Module 19 — Orchestration as Distributed Systems

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-18. Mechanism probe OWN01 **passed**.

Theory:

`docs/learning/lessons/19-orchestration-as-distributed-systems/theory.md`

Practical notes:

`docs/learning/lessons/19-orchestration-as-distributed-systems/notes.md`

## What was implemented

Single-machine durable workflow ownership:

- lease record: `workflowId`, `ownerId`, `fencingToken`, `expiresAt`;
- short per-workflow filesystem mutex only serializes metadata changes;
- acquire / takeover / renew / release;
- fenced `saveWorkflowStateOwned` under the same mutex;
- durable `runV1Harness()` acquires a harness-owned lease before phase work and releases it if it still owns that epoch.

## Important design decisions

Lease ≠ mutex. The short mutex is an `O_EXCL` lock file with a holder token, not a 5s stale-delete. Expiry does not stop the old process. Authoritative writes reject a stale fencing token. Renew does not increment the token. Release does not reset the token. No scheduler, queue, heartbeat loop, or workspace fencing.

`saveWorkflowState()` is no longer a public unfenced durable API; fixtures use `saveWorkflowStateUnfenced`.

## Current result

OWN01 passed (2026-09-18). Separate OS processes. Virtual file clock (no 30s sleeps). A token=1; B blocked while valid; after expiry B token=2; stale A commit/renew/release rejected; B commit `commit-from-B` is the final WorkflowState. Harness unit tests: **239 passed**.

Evidence: `docs/learning/lessons/19-orchestration-as-distributed-systems/traces/OWN01-ownership-2026-09-18T17-31-54-674Z.txt`

Regression: DUR01, CHK01, RET01 all passed after the mutex fail-closed rewrite.

## Closure / remaining boundaries

Topic Chat closure: **PASS** on 2026-09-18.

Fencing does not cover workspace/tool/git/network side effects. No automatic heartbeat, no stateVersion/CAS, no exactly-once semantics, and no cross-machine consensus. The short `O_EXCL` mutex is intentionally fail-closed after a crash inside its critical section and is a local-filesystem learning mechanism, not a distributed lock.

---

# Module 18 — Retry Semantics

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-17. Mechanism probe RET01 **passed**.

Theory draft:

`docs/learning/lessons/18-retry-semantics/theory.md`

Practical notes:

`docs/learning/lessons/18-retry-semantics/notes.md`

## What was implemented

Harness-owned `RetryPolicy` and durable REVIEW retry on `review_ready`:

- `attemptsStarted` persisted before execution;
- known `transient_model_error` → `retryable_transient`; unknown `model_error` fail-closed;
- retry state stays until the next durable semantic boundary (terminal or new `operationId`);
- Worker `ambiguous_side_effect` → `needs_reconciliation`, never blind retry.

## Important design decisions

Retry ≠ resume ≠ repair. Budget is harness-owned. REVIEW is retry-safe; Worker mutation is not. No exactly-once claim. No generic transaction framework.

## Current result

RET01 passed (2026-09-16). Fresh A/B/C processes. Same `operationId` across attempt 1 and 2. Harness unit tests: **221 passed**, including Module 17 checkpoint tests.

Evidence: `docs/learning/lessons/18-retry-semantics/traces/RET01-retry-2026-09-16T21-16-22-470Z.txt`

## Failures / open questions

Topic Chat closed Module 18. Worker reconciliation and exactly-once remain out of scope.

---

# Module 17 — Checkpoint / Resume

**Status:** implemented and measured. Mechanism probe CHK01 **passed**. Topic Chat owns formal closure. Not marked complete.

Theory draft:

`docs/learning/lessons/17-checkpoint-resume/theory.md`

Practical notes:

`docs/learning/lessons/17-checkpoint-resume/notes.md`

## Learning-critical model

```text
Worker + VERIFY PASS
→ persist review_ready (checkpoint completed only after persist)
→ fresh process loads WorkflowState
→ validate exact verified workspace B
→ load durable pre-Worker baseline A
→ reconstruct REVIEW input
→ skip Worker
→ skip pre-review VERIFY
→ independent REVIEW
→ persist terminal
```

```text
phase result produced ≠ phase durably committed
checkpoint = durable semantic recovery point
resume = fresh dispatch from committed semantic state
```

Crash after VERIFY PASS and before persist stays `implementation_ready`. No silent promotion.

## Result (2026-09-12)

Task: T02 DEV. Control + seed/A/B. Harness unit tests: **200 passed**.

| Arm       | workflow  | Worker  | pre-review VERIFY | REVIEW  | terminal                 |
| --------- | --------- | ------- | ----------------- | ------- | ------------------------ |
| Control   | pid 39758 | yes     | PASS              | pass    | persisted                |
| Process A | pid 41111 | yes     | PASS              | skipped | `review_ready` persisted |
| Process B | pid 41457 | skipped | skipped           | pass    | persisted                |

Same interrupted workflow ID. Distinct PIDs. B validated workspace B and reconstructed diff(A, B). Negative B→C mismatch fails closed without REVIEW.

Evidence: `docs/learning/lessons/17-checkpoint-resume/traces/CHK01-checkpoint-2026-09-12T17-46-34-317Z.txt`

Hardened identity rerun (2026-09-14): `processBReconstructedDiffIdentity=yes`. Expected/A/B all `tasks/task-service.ts` / `f4eb436e1d5b`. Evidence: `docs/learning/lessons/17-checkpoint-resume/traces/CHK01-checkpoint-2026-09-14T18-07-21-393Z.txt`. Harness unit tests: **203 passed**.

## Module decision (pending Topic Chat)

```text
review_ready checkpoint = implemented
CHK01                   = passed
default runV1Harness    = still in-memory unless durable is opted in
Module 18 retry         = not started
```

---

# Module 16 — Durable Execution

**Status:** ✅ COMPLETED — formally closed. Mechanism probe DUR01 passed under the hardened independent-REVIEW assertion.

Theory draft:

`docs/learning/lessons/16-durable-execution/theory.md`

Practical notes/evidence:

`docs/learning/lessons/16-durable-execution/notes.md`

## Learning-critical model

```text
model proposes Spec
→ outer harness admits executable Spec
→ persist implementation_ready (checkpoint completed only after rename)
→ process may die
→ fresh process loads WorkflowState
→ bind/validate existing workspace
→ skip Spec
→ existing Worker → VERIFY → REVIEW
→ persist terminal
```

Durable identity is `workflowId`, not one Node `runId` / PID. Trace JSONL is evidence, not authoritative workflow state.

## Result (2026-09-11, post-review DUR01 hardening)

Task: T02 DEV. Control + interrupted/resumed. Harness unit tests: **191 passed**.

Executable PASS now requires Worker + VERIFY PASS + independent REVIEW `pass`, and arm expected outcome requires `finalReviewerOutcome === "pass"`.

| Arm       | workflow  | Spec                         | Worker | VERIFY | REVIEW  | terminal                         |
| --------- | --------- | ---------------------------- | ------ | ------ | ------- | -------------------------------- |
| Control   | pid 45299 | ran                          | yes    | PASS   | pass    | persisted                        |
| Process A | pid 46556 | ran once                     | no     | n/a    | skipped | `implementation_ready` persisted |
| Process B | pid 47362 | skipped (`specModelCalls=0`) | yes    | PASS   | pass    | persisted                        |

Same interrupted workflow ID. Distinct PIDs and invocation IDs. Workspace/base `b5f17482124e` reused. All executable DUR01 assertions passed.

Evidence: `docs/learning/lessons/16-durable-execution/traces/DUR01-durable-2026-09-11T15-17-19-208Z.txt`

## Module decision (pending Topic Chat)

```text
durable checkpoint mechanism = implemented
DUR01                         = passed
default runV1Harness          = still in-memory unless durable is opted in
Module 17 generalized resume  = started as review_ready
```

---

# Module 15 — Stronger Eval Methodology

**Status:** implemented and measured. Qualification claim **supported** on this frozen workload/model snapshot. Topic Chat owns formal closure. Default architecture unchanged.

Theory draft:

`docs/learning/lessons/15-stronger-eval-methodology/theory.md`

Practical notes/evidence:

`docs/learning/lessons/15-stronger-eval-methodology/notes.md`

## Learning-critical model

```text
DEV / known     = used to build, debug, or tune
HOLDOUT         = frozen representative work, unused for tuning
VERIFY          = harness gate the Worker can see
independent grader = benchmark-owned ground truth after terminal outcome
```

Holdout lifecycle:

```text
fresh holdout → evaluate
→ if used to change/tune the evaluated harness
→ becomes DEV/known for future qualification
```

H01/H02 remain `fresh_holdout`. This run did not tune the harness against them.

## Qualification protocol (frozen before outcomes)

```text
T01–T04: 1 regression run each
H01: 3 independent trials from the same frozen base
H02: 3 independent trials from the same frozen base
Claim supported only if:
  T01–T04 no regression
  H01 independent grader 3/3
  H02 independent grader 3/3
  escaped defects 0
  grader calibration valid
```

`2/3` is unsupported, not inconclusive. `3/3` is an observed count, not 100% reliability.

## Result (2026-09-07)

Suite: `qualification-m15`. Model: `gpt-5.6-luna`. Base: `a6b8e5001298`. Invalid trials: none. Contaminated: none.

| Split                  | Result                                      |
| ---------------------- | ------------------------------------------- |
| T01–T04                | 4/4 expected; first-pass 3/3; T04 escalated |
| H01 independent grader | 3/3 PASS; escaped 0/3                       |
| H02 independent grader | 3/3 PASS; escaped 0/3                       |
| Calibration            | valid                                       |
| Verdict                | **supported**                               |

H01 efficiency: wall median 41556ms (37431–74635); model calls median 8 (8–11); tool calls median 18 (16–21); tokens in median 27549 (26678–44651); tokens out median 3284 (3075–4799).

H02 efficiency: wall median 38464ms (30034–41537); model calls median 8 (7–9); tool calls median 16 (16–17); tokens in median 24480 (23493–33871); tokens out median 2870 (2509–3008).

Evidence: `docs/learning/lessons/15-stronger-eval-methodology/traces/2026-09-07T17-26-05-593Z.txt`

Harness unit tests: **174 passed**.

## Module decision (pending Topic Chat)

```text
eval methodology     = implemented
qualification claim  = supported on this frozen workload / gpt-5.6-luna
H01/H02              = still fresh holdout (not used to tune)
normal default       = unchanged
```

---

# Module 13 — Subagents (bounded research child)

**Status:** ✅ COMPLETED — formally accepted by Master. Mechanism implemented and measured. Default architecture unchanged (`subagentsEnabled=false`). P01 ROI inconclusive; natural Workers did not delegate (0/3).

Theory draft:

`docs/learning/lessons/13-subagents/theory.md`

Practical notes/evidence:

`docs/learning/lessons/13-subagents/notes.md`

## Learning-critical model

```text
Worker tool call
→ harness-owned delegation boundary
→ separate read-only child episode
→ validated EvidenceReport (advice, not authority)
→ Worker continues implementation
→ unchanged VERIFY / REVIEW
```

Key boundaries:

- agent-as-tool ≠ outer Planner phase;
- EvidenceReport ≠ Spec / permission / verification / success;
- evidence provenance is harness-observed: a child may only cite paths it actually read;
- child tools are physically restricted (`list_files` / `read_file` / `submit_evidence_report`);
- at most one child per Worker implementation episode;
- `subagentsEnabled=false` remains the default.

## Built

- optional Worker capability `delegate_research({ objective, scope })`;
- harness intercept in `runAgentLoop`;
- bounded read-only child in the same workspace;
- deterministic EvidenceReport admission, including harness-observed read provenance;
- P01 experiment `npm run benchmark:subagents`.

## Controlled experiment

Task: P01  
Context: `contextMode=variant`, `conversationStateMode=manual`  
Trials: 3 valid per arm. Contaminated: none.  
Delegation on variant: **0/3**.

| Arm      | expected | first VERIFY | repairs | calls/tools avg | tokens in/out avg | wall avg | delegated |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- | --------- |
| BASELINE | 3/3      | 3/3 PASS     | 0 / 0   | 9 / 21          | 38,579 / 4,036    | ~47s     | 0/3       |
| VARIANT  | 3/3      | 3/3 PASS     | 0 / 0   | 8 / 22          | 33,015 / 3,652    | ~42s     | 0/3       |

Quality equal. Child never ran, so e2e movement is Worker variance, not subagent ROI. Predefined rule → **mechanism understood / ROI inconclusive**. Do not treat unused `delegate_research` as a win or a reason to force the prompt.

Evidence: `docs/learning/lessons/13-subagents/traces/subagents-m13-2026-08-28T12-27-46-204Z.txt`

Mechanism correctness was proven separately by mocked unit tests (child cannot write/run/delegate; unread citations rejected; second call denied; parent continues).

## Fixed V3 regression

Suite: `fixed-v3-m09`. Subagents stayed off. 6/6 contracts; ISO01 PASS; SEC01 PASS; no hard regressions.

Evidence: `docs/learning/lessons/13-subagents/traces/2026-08-28T12-35-16-210Z.txt`

Harness unit tests: 140 passed (at Module 13 closure).

## Module decision

```text
research-child mechanism = implemented and understood
natural P01 adoption     = not justified / ROI inconclusive
normal default           = Spec → Worker, subagentsEnabled=false
```

Formally closed by Master. Do not reopen.

---

# Module 14 — Human-Reviewable Decomposition

**Status:** ✅ COMPLETED — closed by Topic Chat on 2026-09-01. Mechanism implemented and measured; not adopted as default.

Theory draft:

`docs/learning/lessons/14-human-reviewable-decomposition/theory.md`

Practical notes/evidence:

`docs/learning/lessons/14-human-reviewable-decomposition/notes.md`

## Learning-critical model

```text
Spec
→ [optional] advisory ReviewPlan (manual in this probe)
→ harness-owned UnitExecutionScope per episode
→ sequential semantic units with real source diffs
→ scoped VERIFY gate (FAIL stops later units)
→ final VERIFY / independent REVIEW
```

Key boundaries:

- task decomposition ≠ agent decomposition;
- file decomposition ≠ semantic decomposition;
- Spec ≠ ReviewPlan ≠ UnitExecutionScope;
- `single_change` is first-class;
- no stacked PRs, parallel workers, or LLM Review Planner in this probe.

## Built

- P02 due-date benchmark;
- ReviewPlan / ChangeUnit schema + admission + `UnitExecutionScope`;
- sequential unit snapshots, scoped verification gate, explicit `owns()` mapping;
- `npm run benchmark:decomposition`.

## First P02 experiment (negative)

Quality equal 3/3, first VERIFY PASS, 0 repairs. Variant ~2× cost. A absorbed the full feature; B empty 3/3; C empty 2/3. Advisory ReviewPlan did not bound execution.

Evidence: `docs/learning/lessons/14-human-reviewable-decomposition/traces/decomposition-m14-2026-08-29T11-20-11-746Z.txt`

## Corrected P02 experiment

Same 3×3, `contextMode=variant`, `conversationStateMode=manual`. Contaminated: none. Harness unit tests: **159 passed**.

| Arm      | expected | first VERIFY | repairs | calls/tools avg | tokens in/out avg | wall avg |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- |
| BASELINE | 3/3      | 3/3 PASS     | 0 / 0   | 11 / 25         | 56,861 / 5,539    | ~74s     |
| VARIANT  | 3/3      | 3/3 PASS     | 0 / 0   | 22 / 46         | 130,415 / 10,125  | ~128s    |

Quality equal. Intermediate units always PASS. Empty later diffs: 0. Real `base..A`, `A..B`, `B..C`. Variant still ~2× cost. Decision: **`candidate_pending_human_review`**. Default unchanged.

Evidence: `docs/learning/lessons/14-human-reviewable-decomposition/traces/decomposition-m14-corrected-2026-08-31T12-13-58-044Z.txt`

## Fixed V3 regression

Suite: `fixed-v3-m09`. Review decomposition stayed off. First post-probe run: 6/6 contracts; ISO01 PASS; SEC01 PASS.

Evidence: `docs/learning/lessons/14-human-reviewable-decomposition/traces/2026-08-29T11-33-40-045Z.txt`

After the correction: again 6/6; ISO01 PASS; SEC01 PASS; no hard regressions.

Evidence: `docs/learning/lessons/14-human-reviewable-decomposition/traces/2026-08-31T12-27-55-652Z.txt`

## Module decision

```text
review-decomposition mechanism = implemented + corrected + understood
P02 first experiment           = mechanism_failed / no genuine surfaces
P02 corrected experiment       = candidate_pending_human_review
adoption                       = conditional, not default
normal default                 = Spec → one Worker, single_change first-class
```

Closed by Topic Chat on 2026-09-01. See `docs/learning/lessons/14-human-reviewable-decomposition/closure.md`.

---

# Module 12 — Planner / Worker / Reviewer

**Status:** ✅ COMPLETED — formally closed by Topic Chat on 2026-08-27 after implementation review, controlled experiment, gap fixes, fresh fixed regression, theory rewrite, and understanding check.

Theory:

`docs/learning/lessons/12-planner-worker-reviewer/theory.md`

Practical notes/evidence:

`docs/learning/lessons/12-planner-worker-reviewer/notes.md`

## Learning-critical model

```text
Spec
WHAT must be true
(authority)

Planner
HOW we currently think we should get there
(advisory hypothesis)

Worker
HOW to actually get there given repository reality
(execution + local adaptation)

Reviewer
WHAT is wrong with what was actually produced
(independent judgment)

Orchestrator / harness
WHETHER each phase may run and WHAT happens next
(authority / lifecycle)
```

Key boundaries:

- `Spec > Plan`;
- Planner proposes; harness authorizes;
- role ≠ agent instance ≠ parallelism;
- Worker may locally adapt away from Plan based on repository truth;
- Reviewer does not receive Plan / Planner rationale / Worker reasoning by default;
- deterministic Plan admission checks structure, not semantic truth;
- explicit planning is an optimization candidate, not a mandatory layer.

## Built

- optional read-only Planner episode (`planningEnabled`, default `false`);
- structured advisory `Plan` via `submit_plan` + deterministic admission;
- Worker handoff: resolved Spec separately, Plan is hypothesis not authority;
- Reviewer contract unchanged (no Plan / Planner rationale / Worker conversation);
- P01 priority fixture + `npm run benchmark:planning`.

## Controlled experiment

Task: P01  
Context: `contextMode=variant`, `conversationStateMode=manual`  
Trials: 3 valid per arm, isolated worktree per trial. Contaminated: none.

| Arm      | expected | first VERIFY | repairs | calls/tools avg | tokens in/out avg | wall avg |
| -------- | -------- | ------------ | ------- | --------------- | ----------------- | -------- |
| BASELINE | 3/3      | 3/3 PASS     | 0 / 0   | 8 / 23          | 36,589 / 3,700    | ~51s     |
| VARIANT  | 3/3      | 3/3 PASS     | 0 / 0   | 12 / 31         | 56,633 / 5,309    | ~64s     |

Predefined rule: quality equal and Variant costs more end-to-end → **reject Planner**. Default unchanged.

Evidence: `docs/learning/lessons/12-planner-worker-reviewer/traces/planning-m12-2026-08-27T12-46-15-463Z.txt`

Important interpretation:

```text
Worker-local savings ≠ system savings.
```

On P01 there were not even Worker-local savings: Worker model calls increased on Variant. The result only supports a workload-bounded conclusion: explicit Planner is not justified for this feature-sized task. It does not prove that explicit planning cannot help larger long-running work.

## Review gap fixes

- Plan admission now rejects general `dependsOn` cycles (not only self-deps / invalid indexes). Schema/admission only — no DAG executor.
- Equal-quality decision: no numeric “meaningful” e2e threshold was predefined, so directional efficiency improvement is **inconclusive**, not `candidate`. Clear e2e regression → reject. Conflicting e2e signals → inconclusive. Compared signals: model calls, tool calls, input tokens, output tokens, wall time.
- Historical P01 artifact is unchanged. Re-applying the operationalization still **rejects**: quality equal, all five e2e signals worse on Variant.

P01 was not rerun (admission/decision-report changes do not affect recorded Planner execution).

## Fixed V3 regression after gap fixes

Suite: `fixed-v3-m09`. Planner stayed off. 6/6 contracts; ISO01 PASS; SEC01 PASS; no hard regressions.

Evidence: `docs/learning/lessons/12-planner-worker-reviewer/traces/2026-08-27T13-21-46-170Z.txt`

Harness unit tests: 125 passed.

## Understanding check

Final Topic Chat check passed after one terminology correction.

The learner correctly identified that:

- Worker can deviate from Plan because Plan is advisory and repository truth may invalidate implementation details;
- Planner overhead must be counted end-to-end, not hidden by Worker-local metrics;
- an explicit Planner becomes more plausible on large/complex work where upfront decomposition may reduce backtracking and wasted execution;
- Reviewer should not receive Plan because anchoring can correlate Planner/Worker/Reviewer errors.

Correction:

```text
Spec    = WHAT must be true
Planner = HOW we currently intend to get there
Worker  = HOW to actually get there given repository reality
```

## Module decision

```text
explicit Planner mechanism = implemented and understood
explicit Planner default   = rejected for current feature-sized workload
normal default              = Spec → Worker
```

Revisit explicit planning only when a larger planning-sensitive workload provides evidence that decomposition/reliability gains can repay coordination overhead.

---

# Module 11 — Modern Model-Native Orchestration / Inner vs Outer Loop

**Status:** ✅ COMPLETED — formally closed by Topic Chat on 2026-08-26 after implementation, evidence review, decision correction, theory, and understanding check.

## Goal

Understand **where orchestration responsibility should live** as provider/model runtimes become more capable.

Core distinction:

```text
OUTER HARNESS
→ whether an action/episode should happen
→ policy / permissions / verification / transitions / workflow truth

INNER EPISODE
→ how to execute the currently allowed bounded objective
```

Theory:

`docs/learning/lessons/11-modern-model-native-orchestration/theory.md`

Practical notes:

`docs/learning/lessons/11-modern-model-native-orchestration/notes.md`

## Built

- `conversationStateMode = "manual" | "previous_response_id"`;
- default remains `manual`;
- `previous_response_id` is fully implemented and selectable with `--previous-response-id`;
- each `runAgentLoop` invocation starts a fresh response chain;
- implementation / repair / review_repair do not share one provider response chain across outer checkpoints;
- custom tools remain client-executed via `executeTool()`;
- traces record `conversationStateMode`, `responseId`, `previousResponseId`, `clientInputItemCount`, `clientInputBytes`;
- separate `npm run benchmark:orchestration` experiment; orchestration trials are not folded into the fixed 6/6 denominator.

## Controlled experiment

Task: T02  
Context: `contextMode=variant`  
Trials: 3 per arm, isolated exact-base worktree per trial.

| Arm | mode                 | expected | client items/bytes avg | tokens in/out avg | wall avg |
| --- | -------------------- | -------- | ---------------------- | ----------------- | -------- |
| A   | manual               | 3/3      | 43 / 53,349            | 17,178 / 1,570    | ~23.6s   |
| B   | previous_response_id | 3/3      | 7 / 14,315             | 19,831 / 1,888    | ~32.3s   |

Supported:

```text
correctness on T02                    3/3 both arms
previous_response_id chaining         yes
client full-history replay removed    yes in variant
custom tool authority preserved       yes
outer workflow authority preserved    yes
client payload materially reduced     yes
```

Not established:

```text
token improvement      no
latency improvement    no
stable regression      not proven with n=3
```

## Decision correction

The original generated report used post-hoc token/latency thresholds and therefore incorrectly emitted:

```text
candidate_to_adopt: yes
```

That historical artifact is intentionally preserved unchanged.

Authoritative correction:

`docs/learning/lessons/11-modern-model-native-orchestration/traces/decision-correction-2026-08-26.md`

Current decision:

```text
criterion 1–5      supported
criterion 6        inconclusive
candidate_to_adopt no
normal default     manual
variant            previous_response_id remains available
```

This is an eval-discipline result as well as an orchestration result: thresholds must not be invented after observing the data.

## Fresh variant regression evidence

The fixed suite below was run with `conversationStateMode = previous_response_id` to prove that the variant preserves current contracts when explicitly selected. It is **not** evidence that the variant became the default.

Evidence:

`docs/learning/lessons/11-modern-model-native-orchestration/traces/2026-08-26T11-39-08-076Z.txt`

```text
T01–T04 expected outcomes             4 / 4
Executable first-pass                 3 / 3
Correct escalation T04                1 / 1
R01 verification repair               PASS
REV01 independent review              PASS
ISO01 workspace isolation             PASS
SEC01 verification secret isolation   PASS
All fixed V3 contracts                6 / 6
Hard regressions                      none
```

Harness unit tests at experiment time: 104 passed.

## Understanding check

Final Topic Chat check passed. The learner correctly identified that:

- `baseRevision` / workspace provenance belongs to the outer harness because the harness controls the authoritative workspace;
- retry limits belong to the outer harness because the harness controls whether another semantic attempt is permitted;
- model/tool sequencing and temporary continuation may live inward, but policy, permissions, checkpoints and workflow truth stay outer.

## Learning-critical result

The provider can own more **temporary episode continuation** without owning:

- workspace/base provenance;
- tool permissions;
- VERIFY;
- repair/review counters;
- routing policy;
- human escalation;
- workflow success;
- eval truth.

The current engineering choice is therefore intentionally conservative:

```text
manual continuation = default
previous_response_id = proven mechanism / selectable variant
```

No additional provider-native orchestration infrastructure is required before moving on.

---

# Module 10 — Model Routing

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-25.

Theory:

`docs/learning/lessons/10-model-routing/theory.md`

Practical notes/evidence:

`docs/learning/lessons/10-model-routing/`

## Built

- `resolveModel(episode, config)` as one harness-owned model-selection boundary;
- routing episodes: `spec | implementation | repair | review | review_repair`;
- optional `OPENAI_REPAIR_MODEL` override only for verification `repair`;
- routing provenance: `episode`, selected `model`, `routingReason`;
- controlled R01 routing experiment separate from fixed-suite denominators.

## Routing experiment result

Baseline:

```text
all semantic episodes → gpt-5.6-luna
```

Variant:

```text
spec / implementation / review / review_repair → gpt-5.6-luna
repair → gpt-5.6-terra
```

Both candidates met the predefined R01 SLO 3/3. Quality did not separate them, while Terra did not show enough end-to-end benefit to justify the higher token economics.

Current normal policy remains:

```text
spec            → Luna
implementation  → Luna
repair          → Luna
review          → Luna
review_repair   → Luna
```

The routing boundary remains available for future requalification.

Fresh Module 10 regression evidence:

`docs/learning/lessons/10-model-routing/traces/2026-08-25T11-00-45-136Z.txt`

```text
T01–T04 expected outcomes    4 / 4
Executable first-pass        3 / 3
Correct escalation T04       1 / 1
R01 verification repair      PASS
REV01 independent review     PASS
ISO01 workspace isolation    PASS
SEC01 secret isolation       PASS
All fixed V3 contracts       6 / 6
Hard regressions             none
```

Known non-blocking limits:

1. Routing evidence covers one controlled R01 workload, not broad natural repair diversity.
2. Three trials per arm are learning evidence, not statistical qualification.
3. No task-class/risk/health-aware/model-selected routing yet.
4. No fallback/escalation graph yet.
5. Provider model capabilities/pricing can drift and require requalification.
6. Spec/reviewer quality remains harder to route safely because important misses may be invisible to deterministic graders.
