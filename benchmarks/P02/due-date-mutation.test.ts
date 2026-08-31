import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, request } from "../src/app.ts";

const PAST_DUE = "2000-01-01T00:00:00.000Z";
const FUTURE_DUE = "2099-12-31T00:00:00.000Z";

describe("task due-date mutation", () => {
  it("sets dueAt with PATCH /tasks/:id/due-date", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Needs a date" });
    const id = (created.body as { id: string }).id;

    const patched = request(app, "PATCH", `/tasks/${id}/due-date`, {
      dueAt: FUTURE_DUE,
    });
    assert.equal(patched.status, 200);
    const body = patched.body as { id: string; dueAt: string | null };
    assert.equal(body.id, id);
    assert.equal(body.dueAt, FUTURE_DUE);
  });

  it("clears dueAt with { dueAt: null }", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", {
      title: "Clear me",
      dueAt: PAST_DUE,
    });
    const id = (created.body as { id: string }).id;

    const patched = request(app, "PATCH", `/tasks/${id}/due-date`, {
      dueAt: null,
    });
    assert.equal(patched.status, 200);
    const body = patched.body as { dueAt: string | null };
    assert.equal(body.dueAt, null);
  });

  it("returns 400 for invalid PATCH dueAt", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Bad patch" });
    const id = (created.body as { id: string }).id;

    const patched = request(app, "PATCH", `/tasks/${id}/due-date`, {
      dueAt: "soon",
    });
    assert.equal(patched.status, 400);
  });

  it("returns 404 when patching an unknown task", () => {
    const app = createApp();
    const patched = request(app, "PATCH", "/tasks/missing/due-date", {
      dueAt: FUTURE_DUE,
    });
    assert.equal(patched.status, 404);
  });
});
