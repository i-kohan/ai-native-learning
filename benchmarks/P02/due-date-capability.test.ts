import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, request } from "../src/app.ts";

const PAST_DUE = "2000-01-01T00:00:00.000Z";

describe("task due-date capability", () => {
  it("defaults missing POST dueAt to null", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "No due date" });
    assert.equal(created.status, 201);
    const body = created.body as { dueAt: string | null };
    assert.equal(body.dueAt, null);
  });

  it("accepts a valid dueAt on POST /tasks", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", {
      title: "Has due date",
      dueAt: PAST_DUE,
    });
    assert.equal(created.status, 201);
    const body = created.body as { title: string; dueAt: string | null };
    assert.equal(body.title, "Has due date");
    assert.equal(body.dueAt, PAST_DUE);
  });

  it("returns 400 for invalid POST dueAt", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", {
      title: "Bad due",
      dueAt: "not-a-date",
    });
    assert.equal(created.status, 400);
  });

  it("preserves dueAt across complete and reopen", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", {
      title: "Ship feature",
      dueAt: PAST_DUE,
    });
    const id = (created.body as { id: string }).id;

    const completed = request(app, "POST", `/tasks/${id}/complete`);
    assert.equal(completed.status, 200);
    const completedBody = completed.body as {
      status: string;
      completedAt: string | null;
      dueAt: string | null;
    };
    assert.equal(completedBody.status, "completed");
    assert.equal(typeof completedBody.completedAt, "string");
    assert.equal(completedBody.dueAt, PAST_DUE);

    const reopened = request(app, "POST", `/tasks/${id}/reopen`);
    assert.equal(reopened.status, 200);
    const reopenedBody = reopened.body as {
      status: string;
      completedAt: string | null;
      dueAt: string | null;
    };
    assert.equal(reopenedBody.status, "pending");
    assert.equal(reopenedBody.completedAt, null);
    assert.equal(reopenedBody.dueAt, PAST_DUE);
  });
});
