# 29 — META01 notes

Status: **not closed**. One candidate. No adoption. `runV1Harness()` is unchanged.

## Command

```text
npm run benchmark:meta01 --prefix harness
```

Parent: `afc1abdc0f8f528a3d45b2c1495fea35e74c6aa7` (`fa640a0` plus a type-only `tsc` fix).

## Frozen budgets

```text
Meta-Improver: 12 model turns
maintenance: 16 model turns per trial
candidate: 1
trials: H0 3 + H1 3
patch: <= 3 files, <= 300 additions+deletions
```

## What the improver may change

```text
harness/src/loop.ts
harness/src/loop-ext/<Name>.ts   # create-only, at most two
```

## What the maintenance agent sees

The host sets `HARNESS_EPISODE_EXTENSION=local-inspection` for the grader process. The observable contract is default off, implementation episode only, one `bounded_local_inspection` tool, one success, a denied second call, and `successfulUses` / `deniedUses` on the result.

## Result

`candidate_rejected` on parent `afc1abdc0f8f528a3d45b2c1495fea35e74c6aa7`, run `meta01-2026-10-04T22-11-44-292Z`.

H0 and H1 passed the full regression gate. Integrity passed. Candidate `ac8e333458de9600b4c2e84debd6c98194993c31` adds only `harness/src/loop-ext/worker-capabilities.ts` (+174). `loop.ts` is unchanged. Maintenance grader was 0/3 on both arms. Median core functions and loop lines stayed 0. `main` did not move.

Record: `docs/learning/lessons/29-self-improving/traces/meta01-2026-10-04T22-27-17-924Z.json`.

The `fa640a0` stop was the earlier `tsc` evidence failure. Thresholds were not changed.
