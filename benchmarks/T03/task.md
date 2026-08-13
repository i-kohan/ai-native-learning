# T03 — Filter tasks by status

`GET /tasks` should support:

- `?status=pending`
- `?status=completed`

When `status` is provided, return only matching tasks.
Without `status`, preserve existing behavior (return all tasks).

Implement the missing behavior and verify with tests.
