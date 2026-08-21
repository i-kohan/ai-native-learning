import type { Spec } from "./spec.ts";
import { formatFailureEvidence, type NormalizedFailure } from "./failure.ts";

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;

export type RepairPolicy = {
  maxRepairAttempts: number;
};

export type RepairDecision =
  | { action: "verified_success" }
  | { action: "repair"; attempt: number }
  | {
      action: "stop";
      reason: "max_repair_attempts" | "repeated_failure";
      repeatedFailure: boolean;
    };

/**
 * Harness-owned retry policy. The verifier and the model do not decide this.
 */
export function nextRepairDecision(state: {
  verificationPassed: boolean;
  repairAttemptsUsed: number;
  maxRepairAttempts: number;
  currentFailureSignature: string | null;
  previousFailureSignature: string | null;
  lastRepairChangedFiles: boolean;
}): RepairDecision {
  if (state.verificationPassed) {
    return { action: "verified_success" };
  }

  if (
    state.repairAttemptsUsed > 0 &&
    state.currentFailureSignature !== null &&
    state.currentFailureSignature === state.previousFailureSignature &&
    !state.lastRepairChangedFiles
  ) {
    return {
      action: "stop",
      reason: "repeated_failure",
      repeatedFailure: true,
    };
  }

  if (state.repairAttemptsUsed >= state.maxRepairAttempts) {
    return {
      action: "stop",
      reason: "max_repair_attempts",
      repeatedFailure: false,
    };
  }

  return { action: "repair", attempt: state.repairAttemptsUsed + 1 };
}

export function formatRepairContract(
  originalTask: string,
  spec: Spec,
  failure: NormalizedFailure,
): string {
  return [
    "## Authoritative specification",
    "This resolved spec remains the execution contract. Do not invent product behavior beyond it.",
    "",
    JSON.stringify(spec, null, 2),
    "",
    "## External verification failure (factual evidence)",
    "The harness ran `npm test`. Tests did not pass.",
    "This reports what failed. It is not a diagnosis of why the implementation is wrong, and it does not prescribe a fix.",
    "",
    formatFailureEvidence(failure),
    "",
    "## Repair",
    "This episode repairs the current implementation from the evidence above.",
    "Do not restart from only the original raw task.",
    "Do not modify tests, spec, or the verifier.",
    "When the repair is complete, stop calling tools and reply with a short summary.",
    "",
    "## Original task (provenance only)",
    originalTask,
  ].join("\n");
}
