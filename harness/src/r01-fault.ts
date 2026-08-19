import fs from "node:fs";
import path from "node:path";

const GET_TASK_NOT_FOUND_404 = `function getTask(service: TaskService, id: string): HttpResponse {
  const task = service.get(id);
  if (!task) {
    return { status: 404, body: { error: "task_not_found" } };
  }`;

const GET_TASK_NOT_FOUND_500 = `function getTask(service: TaskService, id: string): HttpResponse {
  const task = service.get(id);
  if (!task) {
    return { status: 500, body: { error: "task_not_found" } };
  }`;

/**
 * Benchmark-only controlled defect for R01.
 * Must run once after initial implementation and never as production harness behavior.
 */
export function injectMissingTask500Fault(targetSrcRoot: string): void {
  const routesPath = path.join(targetSrcRoot, "tasks", "task-routes.ts");
  if (!fs.existsSync(routesPath)) {
    throw new Error(`R01 fault injection failed: missing ${routesPath}`);
  }

  const source = fs.readFileSync(routesPath, "utf8");
  const occurrences = countOccurrences(source, GET_TASK_NOT_FOUND_404);
  if (occurrences !== 1) {
    throw new Error(
      `R01 fault injection failed: expected exactly one getTask 404 not-found return, found ${occurrences}.`,
    );
  }
  if (source.includes(GET_TASK_NOT_FOUND_500)) {
    throw new Error(
      "R01 fault injection failed: getTask already returns 500; refusing to inject.",
    );
  }

  const next = source.replace(GET_TASK_NOT_FOUND_404, GET_TASK_NOT_FOUND_500);
  if (!next.includes(GET_TASK_NOT_FOUND_500)) {
    throw new Error(
      "R01 fault injection failed: replacement did not produce a getTask 500 return.",
    );
  }
  if (next.includes(GET_TASK_NOT_FOUND_404)) {
    throw new Error(
      "R01 fault injection failed: getTask 404 return still present after replacement.",
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
