# P01 — Task priority

Add task priority support:

- Task priority is `"normal" | "high"`.
- `POST /tasks` accepts optional `priority`.
- Missing priority defaults to `"normal"`.
- Invalid priority returns HTTP 400.
- `GET /tasks` accepts `?priority=normal|high`.
- Existing `?status=pending|completed` remains supported.
- `status` and `priority` filters must compose.
- Omitting priority preserves existing list behavior.
- Invalid `priority` query returns HTTP 400.
- Existing complete/reopen/`completedAt` semantics must remain unchanged.

Implement the missing behavior and verify with tests.
Do not modify tests.
