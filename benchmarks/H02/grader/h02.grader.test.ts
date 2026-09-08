import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, request } from "../src/app.ts";

describe("H02 independent grader — DELETE /tasks/:id", () => {
  it("deletes a pending task and hides it from get/list", () => {
    const app = createApp();
    const keep = request(app, "POST", "/tasks", { title: "Keep" });
    const remove = request(app, "POST", "/tasks", { title: "Remove" });
    const keepId = (keep.body as { id: string }).id;
    const removeId = (remove.body as { id: string }).id;

    const deleted = request(app, "DELETE", `/tasks/${removeId}`);
    assert.equal(deleted.status, 204);
    assert.equal(deleted.body, null);

    const got = request(app, "GET", `/tasks/${removeId}`);
    assert.equal(got.status, 404);
    assert.deepEqual(got.body, { error: "task_not_found" });

    const listed = request(app, "GET", "/tasks");
    const ids = (listed.body as Array<{ id: string }>).map((task) => task.id);
    assert.equal(listed.status, 200);
    assert.deepEqual(ids, [keepId]);
  });

  it("deletes a completed task and drops it from the completed filter", () => {
    const app = createApp();
    const pending = request(app, "POST", "/tasks", { title: "Pending" });
    const done = request(app, "POST", "/tasks", { title: "Done" });
    const pendingId = (pending.body as { id: string }).id;
    const doneId = (done.body as { id: string }).id;
    request(app, "POST", `/tasks/${doneId}/complete`);

    const deleted = request(app, "DELETE", `/tasks/${doneId}`);
    assert.equal(deleted.status, 204);

    const completedOnly = request(app, "GET", "/tasks?status=completed");
    assert.equal(completedOnly.status, 200);
    assert.deepEqual(completedOnly.body, []);

    const pendingOnly = request(app, "GET", "/tasks?status=pending");
    assert.equal(pendingOnly.status, 200);
    assert.equal((pendingOnly.body as Array<{ id: string }>).length, 1);
    assert.equal((pendingOnly.body as Array<{ id: string }>)[0].id, pendingId);
  });

  it("returns 404 for complete/reopen after delete and for a missing id", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Gone" });
    const id = (created.body as { id: string }).id;
    request(app, "DELETE", `/tasks/${id}`);

    assert.deepEqual(request(app, "POST", `/tasks/${id}/complete`).body, {
      error: "task_not_found",
    });
    assert.deepEqual(request(app, "POST", `/tasks/${id}/reopen`).body, {
      error: "task_not_found",
    });

    const missing = request(app, "DELETE", "/tasks/missing");
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: "task_not_found" });
  });
});
