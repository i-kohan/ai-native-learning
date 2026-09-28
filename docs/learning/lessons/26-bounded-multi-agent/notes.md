# 26 — SWM01 notes

Status: **not closed**. The seam and deterministic tests exist. The paired model probe did not start.

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

`harness/tests/swarm-investigation.test.ts` — 11 tests, all passed.

Covered:

- plans with 4 workers, 1 worker, an empty objective, duplicate ids, or a `model` / `maxRounds` field are rejected;
- a rejected over-budget plan starts zero workers;
- worker tool list omits `write_file` and `delegate_research`;
- `run.ts` does not reference `SwarmPlan` or SWM01;
- a child cannot cite a path it did not read;
- workers A and C succeed, B is `injected_failure`, B is not called again, synthesis input includes the failure, and the final summary is marked incomplete even when the synthesizer says "full coverage";
- A and C intervals overlap;
- synthesis input does not include raw `function_call` items or file bodies;
- the frozen grader scores a fixture report and flags a wrong `durableSupport`, a missing surface, a missing file, and an SWM01-as-default claim.

Full harness suite on 2026-09-27: **333 passed, 0 failed**. One existing fan-out test calls `loadConfig()`, so the process needs `OPENAI_API_KEY` and `OPENAI_MODEL` set. A placeholder value satisfies that test. It does not call the model.

## Paired probe

Not started.

```text
npx tsx src/swm01-probe.ts
Missing required env OPENAI_API_KEY. Set it in .env or the environment.
exit 1
```

No workspace, no model calls, no trace, no grader scores. There is no base SHA for a live pair and no claim that multi-agent helped or hurt.

## Files to inspect

1. `harness/src/swarm-plan.ts` — admission.
2. `harness/src/investigation-episode.ts` — fresh episode, tool denial, observed reads.
3. `harness/src/investigation-swarm.ts` — `Promise.all`, synthesis input, incomplete coverage.
4. `harness/src/swm01-contract.ts` — frozen surfaces. Do not retune after a run.
5. `harness/src/swm01-grader.ts` — grades the final report only.

Flow: `admitSwarmPlan` → `runChildWorker` inside `Promise.all` → `buildSynthesisInput` → `enforceIncompleteCoverage` → `gradeInvestigationReport`.
