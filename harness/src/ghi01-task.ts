import fs from "node:fs";
import path from "node:path";
import type { Spec } from "./spec.ts";

export const GHI01_REPOSITORY = "i-kohan/ai-native-learning";

export const GHI01_TASK = [
  "Add DELETE /tasks/:id.",
  "",
  "Existing task:",
  "- delete it",
  "- return 200",
  "- body is the deleted task, same shape as POST /tasks/:id/complete",
  "",
  "Missing task:",
  "- return 404",
  '- body { "error": "task_not_found" }',
  "",
  "Add tests.",
].join("\n");

export const GHI01_SPEC: Spec = {
  goal: "Add DELETE /tasks/:id for existing and missing tasks.",
  requirements: [
    "DELETE /tasks/:id deletes an existing task and returns 200 with the deleted task body.",
    'DELETE /tasks/:id for a missing task returns 404 with body {"error":"task_not_found"}.',
    "Add tests for both cases.",
  ],
  constraints: [
    "Do not change unrelated existing behavior.",
    "Keep routing in task-routes and persistence in TaskService.",
  ],
  nonGoals: ["Authentication", "Bulk delete", "Soft delete"],
  acceptance: [
    "Existing task can be deleted and is no longer returned by GET.",
    "Missing task delete returns 404 task_not_found.",
    "Existing tests still pass.",
  ],
  verification: ["npm test"],
  ambiguities: [],
};

export function applyDeleteTasksFixture(workspaceRoot: string): void {
  const servicePath = path.join(
    workspaceRoot,
    "target-app",
    "src",
    "tasks",
    "task-service.ts",
  );
  const routesPath = path.join(
    workspaceRoot,
    "target-app",
    "src",
    "tasks",
    "task-routes.ts",
  );
  let service = fs.readFileSync(servicePath, "utf8");
  if (!service.includes("delete(id: string)")) {
    service = service.replace(
      "  reopen(id: string): Task | undefined {",
      [
        "  delete(id: string): Task | undefined {",
        "    const task = this.tasks.get(id);",
        "    if (!task) {",
        "      return undefined;",
        "    }",
        "    this.tasks.delete(id);",
        "    return task;",
        "  }",
        "",
        "  reopen(id: string): Task | undefined {",
      ].join("\n"),
    );
    fs.writeFileSync(servicePath, service);
  }

  let routes = fs.readFileSync(routesPath, "utf8");
  if (!routes.includes('req.method === "DELETE"')) {
    routes = routes.replace(
      `    if (taskMatch && req.method === "GET") {
      return getTask(service, taskMatch[1]);
    }`,
      `    if (taskMatch && req.method === "GET") {
      return getTask(service, taskMatch[1]);
    }
    if (taskMatch && req.method === "DELETE") {
      return deleteTask(service, taskMatch[1]);
    }`,
    );
    routes = routes.replace(
      "function getTask(service: TaskService, id: string): HttpResponse {",
      [
        "function deleteTask(service: TaskService, id: string): HttpResponse {",
        "  const task = service.delete(id);",
        "  if (!task) {",
        '    return { status: 404, body: { error: "task_not_found" } };',
        "  }",
        "  return { status: 200, body: task };",
        "}",
        "",
        "function getTask(service: TaskService, id: string): HttpResponse {",
      ].join("\n"),
    );
    fs.writeFileSync(routesPath, routes);
  }

  const testsPath = path.join(
    workspaceRoot,
    "target-app",
    "tests",
    "tasks.test.ts",
  );
  let tests = fs.readFileSync(testsPath, "utf8");
  if (!tests.includes("DELETE /tasks/:id")) {
    tests += `
describe("DELETE /tasks/:id", () => {
  it("deletes an existing task", () => {
    const app = createApp();
    const created = request(app, "POST", "/tasks", { title: "Remove me" });
    const id = (created.body as { id: string }).id;

    const res = request(app, "DELETE", \`/tasks/\${id}\`);
    assert.equal(res.status, 200);
    const missing = request(app, "GET", \`/tasks/\${id}\`);
    assert.equal(missing.status, 404);
  });

  it("returns 404 when the task does not exist", () => {
    const app = createApp();
    const res = request(app, "DELETE", "/tasks/missing");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "task_not_found" });
  });
});
`;
    fs.writeFileSync(testsPath, tests);
  }
}
