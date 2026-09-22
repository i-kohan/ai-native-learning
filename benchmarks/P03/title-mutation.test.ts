import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, request } from "../src/app.ts";

describe("task title mutation", () => {
  it("updates title with PATCH /tasks/:id/title", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Old title" });
    const id = (created.body as { id: string }).id;

    const patched = request(app, "PATCH", `/tasks/${id}/title`, {
      title: "  New title  ",
    });
    assert.equal(patched.status, 200);
    const body = patched.body as { id: string; title: string };
    assert.equal(body.id, id);
    assert.equal(body.title, "New title");
  });

  it("returns 400 for missing or blank title", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Keep me" });
    const id = (created.body as { id: string }).id;

    assert.equal(request(app, "PATCH", `/tasks/${id}/title`, {}).status, 400);
    assert.equal(
      request(app, "PATCH", `/tasks/${id}/title`, { title: "   " }).status,
      400,
    );
    assert.equal(
      request(app, "PATCH", `/tasks/${id}/title`, { title: 1 }).status,
      400,
    );
  });

  it("returns 404 when patching an unknown task", () => {
    const app = createApp();
    const patched = request(app, "PATCH", "/tasks/missing/title", {
      title: "Nope",
    });
    assert.equal(patched.status, 404);
  });
});
