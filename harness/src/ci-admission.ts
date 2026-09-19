import { DeliveryError } from "./delivery-error.ts";
import type {
  CiConclusion,
  CiFailureClass,
  CiObservation,
  DeliveryState,
} from "./delivery-state.ts";

export type CiAdmission =
  | { action: "ready_for_human_review" }
  | { action: "repair" }
  | { action: "reobserve" }
  | { action: "fail"; reason: string }
  | { action: "ignore_stale" };

const INFRA_CONCLUSIONS = new Set<CiConclusion>([
  "cancelled",
  "startup_failure",
  "timed_out",
]);

export function classifyCiEvidence(options: {
  expectedHeadSha: string;
  headSha: string;
  conclusion: CiConclusion;
  evidenceExcerpt: string;
}): CiFailureClass | "success" {
  if (options.headSha !== options.expectedHeadSha) {
    return "stale";
  }
  if (options.conclusion === "success") {
    return "success";
  }
  if (INFRA_CONCLUSIONS.has(options.conclusion)) {
    return "infrastructure";
  }
  if (
    options.conclusion === "action_required" ||
    isPolicyEvidence(options.evidenceExcerpt)
  ) {
    return "policy";
  }
  return "semantic";
}

export function admitCurrentHeadCi(options: {
  state: DeliveryState;
  observation: CiObservation;
}): CiAdmission {
  const expected = options.state.expectedHeadSha;
  if (!expected) {
    throw new DeliveryError(
      "illegal_transition",
      "CI admission requires expectedHeadSha.",
    );
  }
  if (options.observation.headSha !== expected) {
    return { action: "ignore_stale" };
  }
  if (
    options.observation.conclusion === "success" &&
    options.observation.failureClass === "success"
  ) {
    return { action: "ready_for_human_review" };
  }
  if (options.observation.failureClass === "stale") {
    return { action: "ignore_stale" };
  }
  if (options.observation.failureClass === "infrastructure") {
    return { action: "reobserve" };
  }
  if (options.observation.failureClass === "policy") {
    return {
      action: "fail",
      reason: "Current-head CI failed as a permanent policy error.",
    };
  }
  if (options.observation.failureClass === "semantic") {
    if (options.state.ciRepairAttempts >= 1) {
      return {
        action: "fail",
        reason: "Semantic CI failure remains after the single allowed repair.",
      };
    }
    return { action: "repair" };
  }
  return {
    action: "fail",
    reason: `Unsupported current-head CI classification: ${options.observation.failureClass}.`,
  };
}

function isPolicyEvidence(excerpt: string): boolean {
  return /permission denied|not authorized|policy violation|required check is not present/i.test(
    excerpt,
  );
}
