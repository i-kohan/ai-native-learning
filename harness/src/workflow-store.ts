import fs from "node:fs";
import path from "node:path";
import { WorkflowError } from "./workflow-error.ts";
import {
  createSpecRequiredState,
  parseWorkflowState,
  type DurableWorkspace,
  type WorkflowState,
} from "./workflow-state.ts";

export function workflowStatePath(storeDir: string, workflowId: string): string {
  return path.join(storeDir, `${sanitizeWorkflowId(workflowId)}.json`);
}

export function initializeWorkflow(options: {
  storeDir: string;
  workflowId: string;
  task: string;
  workspace: DurableWorkspace;
}): WorkflowState {
  const dest = workflowStatePath(options.storeDir, options.workflowId);
  if (fs.existsSync(dest)) {
    throw new WorkflowError(
      "workflow_exists",
      `Workflow state already exists: ${dest}`,
    );
  }
  const state = createSpecRequiredState({
    workflowId: options.workflowId,
    task: options.task,
    workspace: options.workspace,
  });
  saveWorkflowState(options.storeDir, state);
  return state;
}

export function saveWorkflowState(storeDir: string, state: WorkflowState): void {
  const parsed = parseWorkflowState(state);
  if (!parsed.ok) {
    throw new WorkflowError(parsed.code, parsed.error);
  }
  fs.mkdirSync(storeDir, { recursive: true });
  const dest = workflowStatePath(storeDir, parsed.value.workflowId);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(parsed.value, null, 2)}\n`);
    fs.renameSync(tmp, dest);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best-effort cleanup of a leftover temp file.
    }
    throw error;
  }
}

export function loadWorkflowState(
  storeDir: string,
  workflowId: string,
): WorkflowState {
  const dest = workflowStatePath(storeDir, workflowId);
  if (!fs.existsSync(dest)) {
    throw new WorkflowError(
      "missing_state",
      `Workflow state is missing: ${dest}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(dest, "utf8"));
  } catch {
    throw new WorkflowError(
      "corrupt_state",
      `Workflow state is not valid JSON: ${dest}`,
    );
  }

  const parsed = parseWorkflowState(raw);
  if (!parsed.ok) {
    throw new WorkflowError(parsed.code, parsed.error);
  }
  if (parsed.value.workflowId !== workflowId) {
    throw new WorkflowError(
      "corrupt_state",
      `Persisted workflowId ${parsed.value.workflowId} does not match requested ${workflowId}.`,
    );
  }
  return parsed.value;
}

function sanitizeWorkflowId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) {
    throw new WorkflowError("corrupt_state", `Invalid workflow id: ${id}`);
  }
  return cleaned;
}
