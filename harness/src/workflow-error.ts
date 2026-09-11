export type WorkflowErrorCode =
  | "missing_state"
  | "corrupt_state"
  | "unsupported_schema"
  | "unsupported_phase"
  | "illegal_transition"
  | "terminal_resume"
  | "workspace_missing"
  | "workspace_mismatch"
  | "unsupported_mode"
  | "workflow_exists";

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
  }
}
