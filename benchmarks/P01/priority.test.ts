import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, request } from "../src/app.ts";

describe("task priority", () => {
  it("defaults missing POST priority to normal", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Default priority" });
    assert.equal(created.status, 201);
    const body = created.body as { priority: string };
    assert.equal(body.priority, "normal");
  });

  it("accepts high priority on POST /tasks", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", {
      title: "Urgent",
      priority: "high",
    });
    assert.equal(created.status, 201);
    const body = created.body as { priority: string; title: string };
    assert.equal(body.title, "Urgent");
    assert.equal(body.priority, "high");
  });

  it("returns 400 for invalid POST priority", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", {
      title: "Bad",
      priority: "urgent",
    });
    assert.equal(created.status, 400);
  });

  it("filters GET /tasks by priority", () => {
    const app = createApp();
    request(app, "POST", "/tasks", { title: "Normal" });
    const high = request(app, "POST", "/tasks", {
      title: "High",
      priority: "high",
    });
    const highId = (high.body as { id: string }).id;

    const highOnly = request(app, "GET", "/tasks?priority=high");
    assert.equal(highOnly.status, 200);
    const highList = highOnly.body as Array<{ id: string; priority: string }>;
    assert.equal(highList.length, 1);
    assert.equal(highList[0].id, highId);
    assert.equal(highList[0].priority, "high");

    const normalOnly = request(app, "GET", "/tasks?priority=normal");
    assert.equal(normalOnly.status, 200);
    const normalList = normalOnly.body as Array<{ priority: string }>;
    assert.equal(normalList.length, 1);
    assert.equal(normalList[0].priority, "normal");
  });

  it("returns 400 for invalid GET priority", () => {
    const app = createApp();
    const res = request(app, "GET", "/tasks?priority=urgent");
    assert.equal(res.status, 400);
  });

  it("keeps existing status filter", () => {
    const app = createApp();
    const pending = request(app, "POST", "/tasks", { title: "Pending" });
    const done = request(app, "POST", "/tasks", { title: "Done" });
    request(app, "POST", `/tasks/${(done.body as { id: string }).id}/complete`);

    const pendingOnly = request(app, "GET", "/tasks?status=pending");
    assert.equal(pendingOnly.status, 200);
    const pendingList = pendingOnly.body as Array<{ id: string; status: string }>;
    assert.equal(pendingList.length, 1);
    assert.equal(pendingList[0].id, (pending.body as { id: string }).id);
    assert.equal(pendingList[0].status, "pending");
  });

  it("composes status and priority filters", () => {
    const app = createApp();
    request(app, "POST", "/tasks", { title: "Pending normal" });
    const pendingHigh = request(app, "POST", "/tasks", {
      title: "Pending high",
      priority: "high",
    });
    const completedHigh = request(app, "POST", "/tasks", {
      title: "Done high",
      priority: "high",
    });
    request(
      app,
      "POST",
      `/tasks/${(completedHigh.body as { id: string }).id}/complete`,
    );

    const filtered = request(
      app,
      "GET",
      "/tasks?status=pending&priority=high",
    );
    assert.equal(filtered.status, 200);
    const list = filtered.body as Array<{
      id: string;
      status: string;
      priority: string;
    }>;
    assert.equal(list.length, 1);
    assert.equal(list[0].id, (pendingHigh.body as { id: string }).id);
    assert.equal(list[0].status, "pending");
    assert.equal(list[0].priority, "high");
  });

  it("returns all tasks when priority is omitted", () => {
    const app = createApp();
    request(app, "POST", "/tasks", { title: "A" });
    const second = request(app, "POST", "/tasks", {
      title: "B",
      priority: "high",
    });
    request(app, "POST", `/tasks/${(second.body as { id: string }).id}/complete`);

    const all = request(app, "GET", "/tasks");
    assert.equal(all.status, 200);
    assert.equal((all.body as unknown[]).length, 2);
  });

  it("preserves complete and reopen completedAt semantics", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", {
      title: "Ship feature",
      priority: "high",
    });
    const id = (created.body as { id: string }).id;

    const completed = request(app, "POST", `/tasks/${id}/complete`);
    assert.equal(completed.status, 200);
    const completedBody = completed.body as {
      status: string;
      completedAt: string | null;
      priority: string;
    };
    assert.equal(completedBody.status, "completed");
    assert.equal(typeof completedBody.completedAt, "string");
    assert.ok(completedBody.completedAt && completedBody.completedAt.length > 0);
    assert.equal(completedBody.priority, "high");

    const reopened = request(app, "POST", `/tasks/${id}/reopen`);
    assert.equal(reopened.status, 200);
    const reopenedBody = reopened.body as {
      status: string;
      completedAt: string | null;
      priority: string;
    };
    assert.equal(reopenedBody.status, "pending");
    assert.equal(reopenedBody.completedAt, null);
    assert.equal(reopenedBody.priority, "high");
  });
});
