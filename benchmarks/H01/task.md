# H01 — Rename an existing task

Add `PATCH /tasks/:id` so a client can change the title of an existing task.

User-visible contract:

- The request body must be an object that includes `title`.
- `title` must be a string that is non-empty after trimming whitespace.
- Store and return the trimmed title.
- Missing body, a non-object body, omitted `title`, a non-string `title`, or a whitespace-only `title` returns HTTP 400 with `{ "error": "title_required" }`.
- An unknown task id returns HTTP 404 with `{ "error": "task_not_found" }`.
- A successful rename returns HTTP 200 and the updated task.
- `PATCH` must not change `status` or `completedAt`.
- Renaming a completed task keeps `status` as `"completed"` and keeps the same `completedAt` value.
- After a successful rename, `GET /tasks/:id` returns the new title.
- After a successful rename, `GET /tasks` includes the task with the new title.
- Existing `POST /tasks`, `GET /tasks/:id`, complete, reopen, `completedAt`, and `GET /tasks?status=` behavior must remain unchanged.

Implement the missing behavior. Do not modify tests.
