import type { TaskService } from "./task-service.ts";
import type { TaskStatus } from "./types.ts";

export type HttpRequest = {
  method: string;
  pathname: string;
  query: URLSearchParams;
  body?: unknown;
};

export type HttpResponse = {
  status: number;
  body: unknown;
};

export function createTaskRoutes(service: TaskService) {
  return function handleTaskRequest(req: HttpRequest): HttpResponse {
    if (req.method === "GET" && req.pathname === "/tasks") {
      return listTasks(service, req.query);
    }

    if (req.method === "POST" && req.pathname === "/tasks") {
      return createTask(service, req.body);
    }

    const taskMatch = req.pathname.match(/^\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === "GET") {
      return getTask(service, taskMatch[1]);
    }

    const completeMatch = req.pathname.match(/^\/tasks\/([^/]+)\/complete$/);
    if (completeMatch && req.method === "POST") {
      return completeTask(service, completeMatch[1]);
    }

    const reopenMatch = req.pathname.match(/^\/tasks\/([^/]+)\/reopen$/);
    if (reopenMatch && req.method === "POST") {
      return reopenTask(service, reopenMatch[1]);
    }

    return { status: 404, body: { error: "not_found" } };
  };
}

function listTasks(service: TaskService, query: URLSearchParams): HttpResponse {
  const statusParam = query.get("status");
  if (statusParam !== null && statusParam !== "pending" && statusParam !== "completed") {
    return { status: 400, body: { error: "invalid_status" } };
  }

  const status = statusParam as TaskStatus | null;
  return { status: 200, body: service.list(status ?? undefined) };
}

function createTask(service: TaskService, body: unknown): HttpResponse {
  const title = typeof body === "object" && body && "title" in body ? body.title : undefined;
  if (typeof title !== "string" || title.trim() === "") {
    return { status: 400, body: { error: "title_required" } };
  }
  return { status: 201, body: service.create(title.trim()) };
}

function getTask(service: TaskService, id: string): HttpResponse {
  const task = service.get(id);
  if (!task) {
    return { status: 404, body: { error: "task_not_found" } };
  }
  return { status: 200, body: task };
}

function completeTask(service: TaskService, id: string): HttpResponse {
  const task = service.complete(id);
  if (!task) {
    return { status: 404, body: { error: "task_not_found" } };
  }
  return { status: 200, body: task };
}

function reopenTask(service: TaskService, id: string): HttpResponse {
  const task = service.reopen(id);
  if (!task) {
    return { status: 404, body: { error: "task_not_found" } };
  }
  return { status: 200, body: task };
}
