import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, request } from "../src/app.ts";

const PAST_DUE = "2000-01-01T00:00:00.000Z";
const FUTURE_DUE = "2099-12-31T00:00:00.000Z";

describe("task overdue querying", () => {
  it("returns only overdue pending tasks for GET /tasks?due=overdue", () => {
    const app = createApp();
    request(app, "POST", "/tasks", { title: "No date" });
    const overdue = request(app, "POST", "/tasks", {
      title: "Overdue",
      dueAt: PAST_DUE,
    });
    request(app, "POST", "/tasks", {
      title: "Later",
      dueAt: FUTURE_DUE,
    });
    const overdueId = (overdue.body as { id: string }).id;

    const res = request(app, "GET", "/tasks?due=overdue");
    assert.equal(res.status, 200);
    const list = res.body as Array<{ id: string; status: string }>;
    assert.equal(list.length, 1);
    assert.equal(list[0].id, overdueId);
    assert.equal(list[0].status, "pending");
  });

  it("never treats completed tasks as overdue", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", {
      title: "Done but past due",
      dueAt: PAST_DUE,
    });
    const id = (created.body as { id: string }).id;
    request(app, "POST", `/tasks/${id}/complete`);

    const res = request(app, "GET", "/tasks?due=overdue");
    assert.equal(res.status, 200);
    assert.equal((res.body as unknown[]).length, 0);
  });

  it("composes due=overdue with the existing status filter", () => {
    const app = createApp();
    const pendingOverdue = request(app, "POST", "/tasks", {
      title: "Pending overdue",
      dueAt: PAST_DUE,
    });
    const completedOverdue = request(app, "POST", "/tasks", {
      title: "Completed overdue",
      dueAt: PAST_DUE,
    });
    request(
      app,
      "POST",
      `/tasks/${(completedOverdue.body as { id: string }).id}/complete`,
    );

    const pending = request(app, "GET", "/tasks?status=pending&due=overdue");
    assert.equal(pending.status, 200);
    const pendingList = pending.body as Array<{ id: string; status: string }>;
    assert.equal(pendingList.length, 1);
    assert.equal(pendingList[0].id, (pendingOverdue.body as { id: string }).id);
    assert.equal(pendingList[0].status, "pending");

    const completed = request(
      app,
      "GET",
      "/tasks?status=completed&due=overdue",
    );
    assert.equal(completed.status, 200);
    assert.equal((completed.body as unknown[]).length, 0);
  });

  it("returns 400 for an invalid due query", () => {
    const app = createApp();
    const res = request(app, "GET", "/tasks?due=soon");
    assert.equal(res.status, 400);
  });

  it("returns all tasks when due is omitted", () => {
    const app = createApp();
    request(app, "POST", "/tasks", { title: "A", dueAt: PAST_DUE });
    const second = request(app, "POST", "/tasks", { title: "B" });
    request(
      app,
      "POST",
      `/tasks/${(second.body as { id: string }).id}/complete`,
    );

    const all = request(app, "GET", "/tasks");
    assert.equal(all.status, 200);
    assert.equal((all.body as unknown[]).length, 2);
  });

  it("includes a reopened overdue task in overdue results", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", {
      title: "Was done",
      dueAt: PAST_DUE,
    });
    const id = (created.body as { id: string }).id;
    request(app, "POST", `/tasks/${id}/complete`);
    request(app, "POST", `/tasks/${id}/reopen`);

    const res = request(app, "GET", "/tasks?due=overdue");
    assert.equal(res.status, 200);
    const list = res.body as Array<{ id: string }>;
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
  });
});
