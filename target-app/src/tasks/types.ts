export type TaskStatus = "pending" | "completed";

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  completedAt: string | null;
};
