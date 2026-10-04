export type ImprovementHypothesis = {
  observedProblem: string;
  suspectedCause: string;
  proposedMutation: string;
  expectedBenefit: string;
  expectedRisks: string[];
};

export function validateHypothesis(
  value: unknown,
): { ok: true; value: ImprovementHypothesis } | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "hypothesis must be an object" };
  }
  const record = value as Record<string, unknown>;
  const observedProblem = requiredText(record.observedProblem, "observedProblem");
  const suspectedCause = requiredText(record.suspectedCause, "suspectedCause");
  const proposedMutation = requiredText(record.proposedMutation, "proposedMutation");
  const expectedBenefit = requiredText(record.expectedBenefit, "expectedBenefit");
  if (!observedProblem.ok) {
    return observedProblem;
  }
  if (!suspectedCause.ok) {
    return suspectedCause;
  }
  if (!proposedMutation.ok) {
    return proposedMutation;
  }
  if (!expectedBenefit.ok) {
    return expectedBenefit;
  }
  if (!Array.isArray(record.expectedRisks) || record.expectedRisks.length === 0) {
    return { ok: false, error: "expectedRisks must be a non-empty array" };
  }
  const expectedRisks: string[] = [];
  for (const risk of record.expectedRisks) {
    if (typeof risk !== "string" || risk.trim() === "") {
      return { ok: false, error: "expectedRisks entries must be non-empty strings" };
    }
    expectedRisks.push(risk.trim());
  }
  return {
    ok: true,
    value: {
      observedProblem: observedProblem.value,
      suspectedCause: suspectedCause.value,
      proposedMutation: proposedMutation.value,
      expectedBenefit: expectedBenefit.value,
      expectedRisks,
    },
  };
}

function requiredText(
  value: unknown,
  name: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: `${name} must be a non-empty string` };
  }
  return { ok: true, value: value.trim() };
}
