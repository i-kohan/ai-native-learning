# Experiments

## V0 baseline — Agent Loop & Harness

### Hypothesis

A minimal model-driven coding-agent loop with filesystem capabilities and executable feedback can autonomously complete small bounded coding tasks, but will expose limitations around reliability, completion judgment, and ambiguous intent.

### Baseline

V0 harness only:

- single coding agent
- tools: list/read/write + constrained `npm test`
- independent final verification
- no spec / planner / reviewer / repair loop

### Tasks

- T01 — simple local bug (missing task → 404)
- T02 — multi-file `completedAt` behavior
- T03 — `GET /tasks?status=` filter feature
- T04 — ambiguity probe (“less cluttered”)

### Metrics

For T01–T03 (planned):

- final tests PASS / FAIL
- model calls
- tool calls
- wall-clock time
- model claimed completion
- final verification agreement
- notable failure reason

For T04 (planned, qualitative):

- identified ambiguity?
- asked for clarification?
- invented assumptions?
- code change made?

### Results

**Not run yet.** `OPENAI_API_KEY` and `OPENAI_MODEL` were unset during implementation.

Command to run after credentials are in `.env`:

```bash
npm run benchmark:all --prefix harness
```

### Observed failure modes

n/a — waiting on first model baseline.

### Initial conclusion

n/a until T01–T04 are executed once.
