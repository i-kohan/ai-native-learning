import fs from "node:fs";
import path from "node:path";

const COMPLETE_TASK_DELEGATED = `function completeTask(service: TaskService, id: string): HttpResponse {
  const task = service.complete(id);
  if (!task) {
    return { status: 404, body: { error: "task_not_found" } };
  }
  return { status: 200, body: task };
}`;

const COMPLETE_TASK_ROUTE_OWNED = `function completeTask(service: TaskService, id: string): HttpResponse {
  const task = service.get(id);
  if (!task) {
    return { status: 404, body: { error: "task_not_found" } };
  }
  task.status = "completed";
  task.completedAt = new Date().toISOString();
  return { status: 200, body: task };
}`;

/**
 * Benchmark-only controlled ARCH-01 defect for REV01.
 * Observable complete-task behavior stays the same; npm test stays green.
 * Must run once after initial implementation and never as production harness behavior.
 */
export function injectArch01CompleteTaskFault(targetSrcRoot: string): void {
  const routesPath = path.join(targetSrcRoot, "tasks", "task-routes.ts");
  if (!fs.existsSync(routesPath)) {
    throw new Error(`REV01 fault injection failed: missing ${routesPath}`);
  }

  const source = fs.readFileSync(routesPath, "utf8");
  const occurrences = countOccurrences(source, COMPLETE_TASK_DELEGATED);
  if (occurrences !== 1) {
    throw new Error(
      `REV01 fault injection failed: expected exactly one delegated completeTask, found ${occurrences}.`,
    );
  }
  if (source.includes(COMPLETE_TASK_ROUTE_OWNED)) {
    throw new Error(
      "REV01 fault injection failed: completeTask already mutates Task in the route; refusing to inject.",
    );
  }

  const next = source.replace(
    COMPLETE_TASK_DELEGATED,
    COMPLETE_TASK_ROUTE_OWNED,
  );
  if (!next.includes(COMPLETE_TASK_ROUTE_OWNED)) {
    throw new Error(
      "REV01 fault injection failed: replacement did not produce a route-owned completeTask.",
    );
  }
  if (next.includes("service.complete(id)")) {
    throw new Error(
      "REV01 fault injection failed: completeTask still delegates to TaskService.complete.",
    );
  }

  fs.writeFileSync(routesPath, next, "utf8");
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= source.length) {
    const index = source.indexOf(needle, from);
    if (index === -1) {
      break;
    }
    count += 1;
    from = index + needle.length;
  }
  return count;
}
