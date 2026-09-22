import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp, request } from "../src/app.ts";

describe("task deletion", () => {
  it("deletes an existing task and subsequent GET is 404", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Remove me" });
    const id = (created.body as { id: string }).id;

    const deleted = request(app, "DELETE", `/tasks/${id}`);
    assert.equal(deleted.status, 200);
    const body = deleted.body as { id: string; title: string };
    assert.equal(body.id, id);
    assert.equal(body.title, "Remove me");

    const missing = request(app, "GET", `/tasks/${id}`);
    assert.equal(missing.status, 404);
  });

  it("returns 404 when deleting an unknown task", () => {
    const app = createApp();
    const deleted = request(app, "DELETE", "/tasks/missing");
    assert.equal(deleted.status, 404);
  });
});
