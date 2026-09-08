# H02 — Delete a task

Add `DELETE /tasks/:id` so a client can remove an existing task.

User-visible contract:

- Deleting an existing task returns HTTP 204 and an empty body (`null`).
- After a successful delete, `GET /tasks/:id` returns HTTP 404 with `{ "error": "task_not_found" }`.
- After a successful delete, `GET /tasks` does not include that task.
- After a successful delete, `GET /tasks?status=pending` and `GET /tasks?status=completed` do not include that task.
- Deleting an unknown task id returns HTTP 404 with `{ "error": "task_not_found" }`.
- `POST /tasks/:id/complete` and `POST /tasks/:id/reopen` on a deleted id return HTTP 404 with `{ "error": "task_not_found" }`.
- Delete works for both pending and completed tasks.
- Other remaining tasks keep their existing create, get, complete, reopen, `completedAt`, and status-filter behavior.

Implement the missing behavior. Do not modify tests.
