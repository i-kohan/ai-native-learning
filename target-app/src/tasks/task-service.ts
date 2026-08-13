import type { Task, TaskStatus } from "./types.ts";

export class TaskService {
  private tasks = new Map<string, Task>();
  private nextId = 1;

  list(status?: TaskStatus): Task[] {
    const all = [...this.tasks.values()];
    if (!status) {
      return all;
    }
    return all.filter((task) => task.status === status);
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  create(title: string): Task {
    const task: Task = {
      id: String(this.nextId++),
      title,
      status: "pending",
      completedAt: null,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  complete(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) {
      return undefined;
    }
    task.status = "completed";
    task.completedAt = new Date().toISOString();
    return task;
  }

  reopen(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) {
      return undefined;
    }
    task.status = "pending";
    task.completedAt = null;
    return task;
  }
}
