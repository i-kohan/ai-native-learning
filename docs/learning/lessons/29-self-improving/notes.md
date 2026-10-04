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

`experiment_stopped_insufficient_regression_evidence` on `meta01-2026-10-04T21-06-22-807Z`.

H0 `tsc` failed (exit 2) on `fa640a0`. H1 and maintenance were not scored. Integrity passed. Candidate revision `b25ddbe340e8b66f4d67f2c14596ddd5ae04d5f3` adds only `harness/src/loop-ext/capabilities.ts` (+65). `loop.ts` is unchanged. `main` did not move.

Record: `docs/learning/lessons/29-self-improving/traces/meta01-2026-10-04T21-08-37-423Z.json`.

The earlier `EISDIR` abort is a host bug, not this verdict.
