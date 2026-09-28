# 26 — SWM01 notes

Status: **not closed**. One paired probe ran on `gpt-5.6-luna` at `f992e3a`. No adoption claim. Default remains one Worker.

## What this probe is

One breadth-first repository audit, two arms, one frozen grader:

```text
baseline: one read-only investigator → InvestigationReport
variant:  Lead SwarmPlan → harness admission → 2–3 concurrent read-only workers
          → ChildInvestigationReport → Lead synthesis → same InvestigationReport
```

`runV1Harness()` does not call this path.

## Harness policy

`SWARM_INVESTIGATION_POLICY` in `harness/src/swarm-plan.ts`:

```text
minWorkers = 2
maxWorkers = 3
maxRounds = 1
workersReadOnly = true
workersMayDelegate = false
workerMaxTurns = 10
leadPlanMaxTurns = 6
synthesisMaxTurns = 4
baselineMaxTurns = 16
```

Both arms use `config.model` directly. The repair-model override is not consulted.

Worker tools are only `list_files`, `read_file`, and `submit_investigation_report`. Synthesis receives the submit tool and no repository tools. A named `write_file` or `delegate_research` call is rejected by the executor.

## Commands

```bash
cd harness
npm test
npm run benchmark:swm01
```

## Deterministic tests

`harness/tests/swarm-investigation.test.ts` — 13 tests, all passed.

Covered:

- plans with 4 workers, 1 worker, an empty objective, duplicate ids, or a `model` / `maxRounds` field are rejected;
- a rejected over-budget plan starts zero workers;
- worker tool list omits `write_file` and `delegate_research`;
- `run.ts` does not reference `SwarmPlan` or SWM01;
- a child cannot cite a path it did not read;
- workers A and C succeed, B is `injected_failure`, B is not called again, synthesis input includes the failure, and the final summary is marked incomplete even when the synthesizer says "full coverage";
- A and C intervals overlap;
- synthesis input does not include raw `function_call` items or file bodies;
- the frozen grader scores a fixture report and flags a wrong `durableSupport`, a missing surface, a missing file, and an SWM01-as-default claim;
- `workspaceMutationsSince` ignores the post-creation `target-app/node_modules` line and still flags a later file;
- synthesis rejects `docs/b.txt` when the child read it but reported only `docs/a.txt`.

Full harness suite on 2026-09-28 after the review fixes: **335 passed, 0 failed**.

## Paired probe

2026-09-28. Model `gpt-5.6-luna`. Base SHA `f992e3a669860ba49f51f265d1f0f604bb6f851b`.

Trace: `docs/learning/lessons/26-bounded-multi-agent/traces/swm01-2026-09-28T11-04-13-012Z.json`.

| Arm | Wall | Input tokens | Coverage | Correctness |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 70,200 ms | 174,332 | 8/9 | 0.25 |
| Variant | 107,213 ms | 621,400 | 9/9 | 0.7778 |

Three workers genuinely overlapped. The variant used about 3.56× the baseline input tokens and was about 53% slower end to end.

`mechanismPass` on that trace is false. `createWorkspace()` symlinks `target-app/node_modules`, and the probe treated `?? target-app/node_modules` as a mutation. The ten live mechanism checks were true. Cleanliness now diffs against the post-creation git status. The check was not removed.

`droppedChildEvidencePaths` lists child evidence paths missing from the final report. It does not mean "no child findings were lost."

The frozen grader was not retuned. No adoption claim. Default remains one Worker.

## Fresh pair after the review fixes

2026-09-28. Model `gpt-5.6-luna`. Base SHA `828eafadf4b1e3b8cec3d89728f1ddff4fbefd69` (includes the SWM01 commit; not `f992e3a`).

Trace: `docs/learning/lessons/26-bounded-multi-agent/traces/swm01-2026-09-28T11-48-16-516Z.json`.

`mechanismPass`: **true**. Workspace clean against the post-creation baseline. Three workers overlapped. `mechanism-entry-inventory` failed with `max_turns_exceeded` and was not respawned.

| Arm | Wall | Input tokens | Coverage | Correctness |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 46,894 ms | 209,701 | 8/9 | 0.25 |
| Variant | 89,073 ms | 615,951 | 8/9 | 0 |

Changed versus the `f992e3a` pair: mechanism false → true; baseline grade unchanged (8/9, 0.25); variant coverage 9/9 → 8/9; variant correctness 0.7778 → 0. This pair's variant used about 2.94× baseline input tokens and was about 90% slower. `droppedChildEvidencePaths`: 6. That count is missing evidence paths, not preserved findings.

## Third pair

2026-09-28. Same model and SHA `828eafadf4b1e3b8cec3d89728f1ddff4fbefd69`. Grader unchanged.

Trace: `docs/learning/lessons/26-bounded-multi-agent/traces/swm01-2026-09-28T15-24-39-165Z.json`.

`mechanismPass`: **true**. All three workers succeeded and overlapped.

| Arm | Wall | Input tokens | Coverage | Correctness |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 88,096 ms | 290,930 | 8/9 | 1 |
| Variant | 90,206 ms | 533,716 | 7/9 | 0.7143 |

The variant missed `review_plan` and `github_ci_delivery`. About 1.83× baseline input tokens, wall time about 2% higher. `droppedChildEvidencePaths`: 13.

## Files to inspect

1. `harness/src/swarm-plan.ts` — admission.
2. `harness/src/investigation-episode.ts` — fresh episode, tool denial, observed reads.
3. `harness/src/investigation-swarm.ts` — `Promise.all`, synthesis input, incomplete coverage.
4. `harness/src/swm01-contract.ts` — frozen surfaces. Do not retune after a run.
5. `harness/src/swm01-grader.ts` — grades the final report only.

Flow: `admitSwarmPlan` → `runChildWorker` inside `Promise.all` → `buildSynthesisInput` → `enforceIncompleteCoverage` → `gradeInvestigationReport`.
