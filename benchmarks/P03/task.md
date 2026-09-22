# P03 — Independent title mutation and task deletion

Add two independent task operations. They have no semantic dependency on each other.

## Unit A — task title mutation

- `PATCH /tasks/:id/title` updates an existing task title.
- The body must be an object that contains a `title` property.
- `title` must be a non-empty string. Trim before storing.
- Missing `title`, a non-object body, a non-string title, or a blank/whitespace-only title returns HTTP 400.
- Unknown task returns HTTP 404.
- Success returns HTTP 200 with the updated task.

## Unit B — task deletion

- `DELETE /tasks/:id` deletes an existing task.
- Existing task returns HTTP 200 with the deleted task.
- A subsequent `GET /tasks/:id` for that id returns HTTP 404.
- Unknown task returns HTTP 404.

## Existing behavior

- Existing title, status, complete/reopen/`completedAt`, and list-filter behavior must remain unchanged.
- Existing tests in `tests/tasks.test.ts` must continue to pass.

Implement the missing behavior and verify with tests.
Do not modify tests.
