import { TaskService } from "./tasks/task-service.ts";
import { createTaskRoutes, type HttpRequest, type HttpResponse } from "./tasks/task-routes.ts";

export type App = {
  handle: (req: HttpRequest) => HttpResponse;
  service: TaskService;
};

export function createApp(): App {
  const service = new TaskService();
  const handleTasks = createTaskRoutes(service);

  return {
    service,
    handle(req: HttpRequest): HttpResponse {
      return handleTasks(req);
    },
  };
}

export function request(
  app: App,
  method: string,
  pathWithQuery: string,
  body?: unknown,
): HttpResponse {
  const url = new URL(pathWithQuery, "http://localhost");
  return app.handle({
    method,
    pathname: url.pathname,
    query: url.searchParams,
    body,
  });
}
