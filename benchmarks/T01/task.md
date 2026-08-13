# T01 — Missing task returns wrong status

Requesting a task that does not exist currently returns HTTP 500.

Expected: HTTP 404 with a clear not-found error body.

Find the bug, fix it, and verify with tests.
