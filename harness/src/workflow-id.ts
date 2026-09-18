import { WorkflowError } from "./workflow-error.ts";

export function sanitizeWorkflowId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) {
    throw new WorkflowError("corrupt_state", `Invalid workflow id: ${id}`);
  }
  return cleaned;
}
