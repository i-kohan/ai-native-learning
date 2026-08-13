# Learning Progress

## Module: 01 — Agent Loop & Harness

**Status:** implementation + deterministic checks ready for Topic Chat review  
**Not marked fully completed yet.**

### Built

- `target-app/` — small Task Board (in-memory TS API + `npm test`)
- `harness/` — explicit model→tool→observation loop using OpenAI Responses API
- Tools with capability boundaries: `list_files`, `read_file`, `write_file`, `run_command`
- Independent final verification (`npm test`) after the model claims done
- JSONL traces under `traces/`
- Benchmarks `T01`–`T04` with fixture restore + setup patches
- Root `.env` / `.env.example` for `OPENAI_API_KEY` and `OPENAI_MODEL`

### Important design decisions

- One readable loop in `harness/src/loop.ts` — no agent framework
- Model is never the authority on completion; harness always re-runs tests
- No automatic repair after final verification fails (intentional V0 limitation)
- `run_command` allows only `npm test` (cwd fixed to `target-app/`)
- `write_file` restricted to `target-app/src/`; benchmarks/docs/harness unreachable
- Nested `node:test` needs `NODE_TEST_*` stripped from child env, otherwise verification falsely passes

### Tasks executed

- Deterministic: `target-app` tests, harness boundary tests, benchmark setup validation for T01–T03
- Model experiment T01–T04: **not run yet** — `OPENAI_API_KEY` / `OPENAI_MODEL` were empty

### Current results

| Check | Result |
|-------|--------|
| `npm test` (target + harness) | PASS |
| T01–T03 initial setup fails tests | PASS (validated) |
| T01–T04 agent runs | pending credentials |

### Observed failures

- None in the agent loop yet (model runs not executed)
- During harness testing: nested `npm test` under `node:test` skipped child suites until env cleanup

### Open questions

- How often will the model claim done while final verification still fails?
- Will T04 ask for clarification, invent a filter default, or change code anyway?
- Is max-turns=20 enough for multi-file tasks without repair scaffolding?

### Remaining to run (after filling `.env`)

```bash
# edit .env:
# OPENAI_API_KEY=...
# OPENAI_MODEL=...

npm run benchmark --prefix harness -- T01
npm run benchmark --prefix harness -- T02
npm run benchmark --prefix harness -- T03
npm run benchmark --prefix harness -- T04
# or:
npm run benchmark:all --prefix harness
```

Then update `docs/learning/experiments.md` with real metrics and revisit this progress entry.
