import { median, type TrialMetric } from "./metrics.ts";
import type { Meta01Decision } from "./policy.ts";
import { META01_TRIALS_PER_ARM } from "./policy.ts";

export type DecisionInput = {
  integrityPassed: boolean;
  h0RegressionConfirmed: boolean;
  h1RegressionPassed: boolean;
  insufficientRegressionEvidence: boolean;
  authorityExpanded: boolean;
  forbiddenFilesMutated: boolean;
  pristineArchitectureFault: boolean;
  provenance: "valid" | "invalid";
  h0: TrialMetric[];
  h1: TrialMetric[];
};

export function decideMeta01(input: DecisionInput): {
  decision: Meta01Decision;
  reasons: string[];
} {
  if (input.insufficientRegressionEvidence) {
    return {
      decision: "experiment_stopped_insufficient_regression_evidence",
      reasons: [
        "H0 did not confirm the frozen regression contracts in this environment. H1 was not scored.",
      ],
    };
  }
  if (input.integrityPassed && !input.h0RegressionConfirmed) {
    return {
      decision: "experiment_stopped_insufficient_regression_evidence",
      reasons: [
        "H0 regression was not confirmed before H1 scoring. META01 stopped.",
      ],
    };
  }

  const reasons: string[] = [];
  if (!input.integrityPassed) {
    reasons.push("candidate integrity gate failed");
  }
  if (input.authorityExpanded) {
    reasons.push("candidate expanded authority");
  }
  if (input.forbiddenFilesMutated) {
    reasons.push("candidate mutated a forbidden file");
  }
  if (input.pristineArchitectureFault) {
    reasons.push("pristine admitted H1 failed the default-path architecture check");
  }
  if (
    input.integrityPassed &&
    !input.pristineArchitectureFault &&
    !input.h1RegressionPassed
  ) {
    reasons.push("H1 failed the existing regression gate");
  }
  if (reasons.length > 0) {
    return { decision: "candidate_rejected", reasons };
  }

  if (
    input.provenance !== "valid" ||
    input.h0.length !== META01_TRIALS_PER_ARM ||
    input.h1.length !== META01_TRIALS_PER_ARM
  ) {
    return {
      decision: "candidate_rejected",
      reasons: ["invalid, mismatched, or uncontrolled provenance"],
    };
  }

  const h0Passes = input.h0.filter((trial) => trial.externalGraderPassed).length;
  const h1Passes = input.h1.filter((trial) => trial.externalGraderPassed).length;
  const coreH0 = median(input.h0.map((trial) => trial.coreFunctionsTouched.length));
  const coreH1 = median(input.h1.map((trial) => trial.coreFunctionsTouched.length));
  const loopH0 = median(input.h0.map((trial) => trial.loopChangedLines));
  const loopH1 = median(input.h1.map((trial) => trial.loopChangedLines));
  const totalH0 = median(input.h0.map((trial) => trial.totalChangedLines));
  const totalH1 = median(input.h1.map((trial) => trial.totalChangedLines));
  const couplingLower = coreH0 !== null && coreH1 !== null && coreH1 < coreH0;
  const accepted =
    h1Passes === META01_TRIALS_PER_ARM &&
    h1Passes >= h0Passes &&
    couplingLower &&
    loopH0 !== null &&
    loopH1 !== null &&
    loopH1 < loopH0 &&
    totalH0 !== null &&
    totalH1 !== null &&
    totalH1 <= totalH0;

  if (accepted) {
    return {
      decision: "candidate_accepted_for_this_workload",
      reasons: [
        "hard gates passed",
        "H1 maintenance grader 3/3",
        "H1 maintenance success was not worse than H0",
        "median coreFunctionsTouched and loopChangedLines were strictly lower on H1",
        "median totalChangedLines was not greater on H1",
      ],
    };
  }
  if (couplingLower) {
    return {
      decision: "candidate_promising_but_inconclusive",
      reasons: [
        "hard gates passed and provenance is valid",
        "median coreFunctionsTouched was lower on H1",
        "structural or maintenance trade-offs did not meet the frozen acceptance rule",
      ],
    };
  }
  return {
    decision: "candidate_rejected",
    reasons: [
      "hard gates passed and provenance is valid",
      "frozen structural improvement conditions were not met",
    ],
  };
}
