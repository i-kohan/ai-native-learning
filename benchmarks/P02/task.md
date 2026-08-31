# P02 — Task due dates

Add optional task due dates:

- Task has optional `dueAt: string | null`.
- `POST /tasks` accepts optional `dueAt`.
- Missing `dueAt` defaults to `null`.
- Explicit `dueAt: null` on create is accepted as `null`.
- A valid `dueAt` is a non-empty string that `Date.parse` accepts. Store and return the supplied string. Do not canonicalize.
- Invalid `dueAt` on create returns HTTP 400: non-string (other than null), empty string, or a string `Date.parse` rejects.

- `PATCH /tasks/:id/due-date` updates `dueAt`.
- The body must be an object that includes the `dueAt` property.
- `{ dueAt: null }` clears it.
- Omitting `dueAt`, a non-object body, or an invalid `dueAt` returns HTTP 400.
- Unknown task returns HTTP 404.

- `GET /tasks?due=overdue` returns only overdue pending tasks.
- A task is overdue when `status` is `"pending"` and `Date.parse(dueAt)` is strictly before now.
- Completed tasks are never overdue.
- `due` filtering composes with the existing `status` filter.
- Invalid `due` query (any value other than `overdue`) returns HTTP 400.
- Omitting `due` preserves existing list behavior.

- `complete` preserves `dueAt`.
- `reopen` preserves `dueAt`.
- Therefore reopening an overdue task makes it eligible for overdue querying again.

- Existing title, status, complete/reopen/`completedAt` behavior must remain unchanged.

Implement the missing behavior and verify with tests.
Do not modify tests.
