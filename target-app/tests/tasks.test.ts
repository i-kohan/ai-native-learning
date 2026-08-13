import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, request } from "../src/app.ts";

describe("GET /tasks/:id", () => {
  it("returns 404 when the task does not exist", () => {
    const app = createApp();
    const res = request(app, "GET", "/tasks/missing");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "task_not_found" });
  });

  it("returns the task when it exists", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Write tests" });
    assert.equal(created.status, 201);
    const id = (created.body as { id: string }).id;

    const res = request(app, "GET", `/tasks/${id}`);
    assert.equal(res.status, 200);
    assert.equal((res.body as { title: string }).title, "Write tests");
  });
});

describe("complete and reopen", () => {
  it("sets completedAt when a task becomes completed", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Ship feature" });
    const id = (created.body as { id: string }).id;

    const completed = request(app, "POST", `/tasks/${id}/complete`);
    assert.equal(completed.status, 200);
    const body = completed.body as { status: string; completedAt: string | null };
    assert.equal(body.status, "completed");
    assert.equal(typeof body.completedAt, "string");
    assert.ok(body.completedAt && body.completedAt.length > 0);
  });

  it("clears completedAt when a completed task is reopened", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Ship feature" });
    const id = (created.body as { id: string }).id;
    request(app, "POST", `/tasks/${id}/complete`);

    const reopened = request(app, "POST", `/tasks/${id}/reopen`);
    assert.equal(reopened.status, 200);
    const body = reopened.body as { status: string; completedAt: string | null };
    assert.equal(body.status, "pending");
    assert.equal(body.completedAt, null);
  });
});

describe("GET /tasks status filter", () => {
  it("returns only matching tasks when status is provided", () => {
    const app = createApp();
    const pending = request(app, "POST", "/tasks", { title: "Pending task" });
    const done = request(app, "POST", "/tasks", { title: "Done task" });
    const doneId = (done.body as { id: string }).id;
    request(app, "POST", `/tasks/${doneId}/complete`);

    const pendingOnly = request(app, "GET", "/tasks?status=pending");
    assert.equal(pendingOnly.status, 200);
    const pendingList = pendingOnly.body as Array<{ id: string; status: string }>;
    assert.equal(pendingList.length, 1);
    assert.equal(pendingList[0].id, (pending.body as { id: string }).id);
    assert.equal(pendingList[0].status, "pending");

    const completedOnly = request(app, "GET", "/tasks?status=completed");
    assert.equal(completedOnly.status, 200);
    const completedList = completedOnly.body as Array<{ id: string; status: string }>;
    assert.equal(completedList.length, 1);
    assert.equal(completedList[0].id, doneId);
    assert.equal(completedList[0].status, "completed");
  });

  it("returns all tasks when status is omitted", () => {
    const app = createApp();
    request(app, "POST", "/tasks", { title: "A" });
    const second = request(app, "POST", "/tasks", { title: "B" });
    request(app, "POST", `/tasks/${(second.body as { id: string }).id}/complete`);

    const all = request(app, "GET", "/tasks");
    assert.equal(all.status, 200);
    assert.equal((all.body as unknown[]).length, 2);
  });
});
