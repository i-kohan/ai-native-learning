import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, request } from "../src/app.ts";

describe("H01 independent grader — PATCH /tasks/:id", () => {
  it("renames a pending task and trims the title", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Old title" });
    const id = (created.body as { id: string }).id;

    const patched = request(app, "PATCH", `/tasks/${id}`, {
      title: "  New title  ",
    });
    assert.equal(patched.status, 200);
    const body = patched.body as {
      title: string;
      status: string;
      completedAt: string | null;
    };
    assert.equal(body.title, "New title");
    assert.equal(body.status, "pending");
    assert.equal(body.completedAt, null);

    const got = request(app, "GET", `/tasks/${id}`);
    assert.equal(got.status, 200);
    assert.equal((got.body as { title: string }).title, "New title");
  });

  it("preserves completedAt when renaming a completed task", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Ship" });
    const id = (created.body as { id: string }).id;
    const completed = request(app, "POST", `/tasks/${id}/complete`);
    const completedAt = (completed.body as { completedAt: string }).completedAt;

    const patched = request(app, "PATCH", `/tasks/${id}`, {
      title: "Shipped",
    });
    assert.equal(patched.status, 200);
    const body = patched.body as {
      title: string;
      status: string;
      completedAt: string | null;
    };
    assert.equal(body.title, "Shipped");
    assert.equal(body.status, "completed");
    assert.equal(body.completedAt, completedAt);
  });

  it("lists the updated title and still filters by status", () => {
    const app = createApp();
    const pending = request(app, "POST", "/tasks", { title: "A" });
    const done = request(app, "POST", "/tasks", { title: "B" });
    const pendingId = (pending.body as { id: string }).id;
    const doneId = (done.body as { id: string }).id;
    request(app, "POST", `/tasks/${doneId}/complete`);
    request(app, "PATCH", `/tasks/${pendingId}`, { title: "Renamed A" });

    const all = request(app, "GET", "/tasks");
    const titles = (all.body as Array<{ title: string }>).map((task) => task.title);
    assert.equal(all.status, 200);
    assert.ok(titles.includes("Renamed A"));

    const pendingOnly = request(app, "GET", "/tasks?status=pending");
    assert.equal(pendingOnly.status, 200);
    const pendingList = pendingOnly.body as Array<{ id: string; title: string }>;
    assert.equal(pendingList.length, 1);
    assert.equal(pendingList[0].id, pendingId);
    assert.equal(pendingList[0].title, "Renamed A");
  });

  it("rejects invalid title updates with 400", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Keep" });
    const id = (created.body as { id: string }).id;

    assert.equal(request(app, "PATCH", `/tasks/${id}`, "x").status, 400);
    assert.deepEqual(request(app, "PATCH", `/tasks/${id}`, {}).body, {
      error: "title_required",
    });
    assert.equal(
      request(app, "PATCH", `/tasks/${id}`, { title: 12 }).status,
      400,
    );
    assert.equal(
      request(app, "PATCH", `/tasks/${id}`, { title: "   " }).status,
      400,
    );
  });

  it("returns 404 for an unknown task", () => {
    const app = createApp();
    const res = request(app, "PATCH", "/tasks/missing", { title: "Nope" });
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "task_not_found" });
  });
});
