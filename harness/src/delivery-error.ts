export type DeliveryErrorCode =
  | "missing_state"
  | "corrupt_state"
  | "unsupported_schema"
  | "unsupported_phase"
  | "illegal_transition"
  | "delivery_exists"
  | "protected_branch"
  | "unexpected_remote_head"
  | "stale_ci_evidence"
  | "ambiguous_side_effect"
  | "missing_credentials"
  | "not_owner"
  | "lease_held"
  | "lease_expired"
  | "stale_fencing_token"
  | "workspace_mismatch"
  | "ci_timeout"
  | "delivery_failed";

export class DeliveryError extends Error {
  readonly code: DeliveryErrorCode;
  readonly operation?: string;

  constructor(
    code: DeliveryErrorCode,
    message: string,
    options?: { operation?: string },
  ) {
    super(message);
    this.name = "DeliveryError";
    this.code = code;
    this.operation = options?.operation;
  }
}
