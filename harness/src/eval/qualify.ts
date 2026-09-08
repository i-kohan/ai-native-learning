import { requireCatalogEntry } from "./catalog.ts";
import {
  QUALIFICATION_CLAIM,
  QUALIFICATION_DECISION_RULE,
  QUALIFICATION_SUITE_VERSION,
  type EvalResult,
  type QualificationVerdict,
} from "./types.ts";

export type CalibrationValidity = {
  valid: boolean;
  reasons: string[];
};

export type QualificationInput = {
  evalResult: EvalResult;
  calibration: CalibrationValidity;
  configuredModel?: string | null;
  expectedModel?: string | null;
  expectedBaseRevision?: string | null;
  invalidTrials?: string[];
  environmentUncontrolled?: boolean;
};

export type QualificationDecision = {
  suiteVersion: string;
  claim: string;
  decisionRule: string;
  verdict: QualificationVerdict;
  claimSupported: boolean;
  reasons: string[];
  t01t04RegressionFree: boolean;
  h01ExpectedOutcome: { met: number; total: number };
  h02ExpectedOutcome: { met: number; total: number };
  h01IndependentGrader: { met: number; total: number };
  h02IndependentGrader: { met: number; total: number };
  escapedDefects: number;
  calibrationValid: boolean;
};

export function decideQualification(
  input: QualificationInput,
): QualificationDecision {
  const holdout = input.evalResult.holdout;
  const h01 = holdoutTask(holdout, "H01");
  const h02 = holdoutTask(holdout, "H02");
  const h01Expected = holdoutExpectedOutcome(input.evalResult, "H01");
  const h02Expected = holdoutExpectedOutcome(input.evalResult, "H02");
  const escapedDefects = holdout.escapedDefects.met;
  const t01t04RegressionFree = capabilityRegressionFree(input.evalResult);
  const contamination = holdoutContamination(input.evalResult);
  const provenanceIssues = qualificationProvenanceIssues(input);
  const invalidTrials = input.invalidTrials ?? [];

  const reasons: string[] = [];
  let verdict: QualificationVerdict = "supported";

  if (!input.calibration.valid) {
    reasons.push(
      `grader calibration invalid: ${input.calibration.reasons.join("; ") || "unspecified"}`,
    );
    verdict = "inconclusive";
  }
  if (contamination.length > 0) {
    reasons.push(`holdout contamination: ${contamination.join(", ")}`);
    verdict = "inconclusive";
  }
  if (invalidTrials.length > 0) {
    reasons.push(`invalid trials: ${invalidTrials.join(", ")}`);
    verdict = "inconclusive";
  }
  if (input.environmentUncontrolled) {
    reasons.push("uncontrolled environment or model change");
    verdict = "inconclusive";
  }
  if (provenanceIssues.length > 0) {
    reasons.push(...provenanceIssues);
    verdict = "inconclusive";
  }

  if (verdict === "inconclusive") {
    return decision(input, {
      verdict,
      claimSupported: false,
      reasons,
      t01t04RegressionFree,
      h01Expected,
      h02Expected,
      h01,
      h02,
      escapedDefects,
    });
  }

  if (!t01t04RegressionFree) {
    reasons.push("T01–T04 regression: a known capability contract was not met");
    verdict = "regression";
  }
  if (escapedDefects > 0) {
    reasons.push(
      `escaped defects: ${escapedDefects} (VERIFY PASS + independent grader FAIL)`,
    );
    verdict = "regression";
  }
  if (h01Expected.met !== 3 || h01Expected.total !== 3) {
    reasons.push(
      `H01 full expected outcome ${h01Expected.met}/${h01Expected.total} does not satisfy 3/3`,
    );
    if (verdict === "supported") {
      verdict = "unsupported";
    }
  }
  if (h02Expected.met !== 3 || h02Expected.total !== 3) {
    reasons.push(
      `H02 full expected outcome ${h02Expected.met}/${h02Expected.total} does not satisfy 3/3`,
    );
    if (verdict === "supported") {
      verdict = "unsupported";
    }
  }
  if (h01.met !== 3 || h01.total !== 3) {
    reasons.push(
      `H01 independent grader ${h01.met}/${h01.total} does not satisfy 3/3`,
    );
    if (verdict === "supported") {
      verdict = "unsupported";
    }
  }
  if (h02.met !== 3 || h02.total !== 3) {
    reasons.push(
      `H02 independent grader ${h02.met}/${h02.total} does not satisfy 3/3`,
    );
    if (verdict === "supported") {
      verdict = "unsupported";
    }
  }

  const claimSupported = verdict === "supported";
  if (claimSupported) {
    reasons.push(
      "T01–T04 contracts held; H01 full outcome 3/3 + grader 3/3; H02 full outcome 3/3 + grader 3/3; escaped defects 0; calibration valid; provenance frozen",
    );
    reasons.push(
      "Workload-bounded: 3/3 is an observed count, not 100% reliability",
    );
  }

  return decision(input, {
    verdict,
    claimSupported,
    reasons,
    t01t04RegressionFree,
    h01Expected,
    h02Expected,
    h01,
    h02,
    escapedDefects,
  });
}

function decision(
  input: QualificationInput,
  fields: {
    verdict: QualificationVerdict;
    claimSupported: boolean;
    reasons: string[];
    t01t04RegressionFree: boolean;
    h01Expected: { met: number; total: number };
    h02Expected: { met: number; total: number };
    h01: { met: number; total: number };
    h02: { met: number; total: number };
    escapedDefects: number;
  },
): QualificationDecision {
  return {
    suiteVersion: QUALIFICATION_SUITE_VERSION,
    claim: QUALIFICATION_CLAIM,
    decisionRule: QUALIFICATION_DECISION_RULE,
    verdict: fields.verdict,
    claimSupported: fields.claimSupported,
    reasons: fields.reasons,
    t01t04RegressionFree: fields.t01t04RegressionFree,
    h01ExpectedOutcome: fields.h01Expected,
    h02ExpectedOutcome: fields.h02Expected,
    h01IndependentGrader: fields.h01,
    h02IndependentGrader: fields.h02,
    escapedDefects: fields.escapedDefects,
    calibrationValid: input.calibration.valid,
  };
}

function holdoutTask(
  holdout: EvalResult["holdout"],
  taskId: string,
): { met: number; total: number } {
  const found = holdout.tasks.find((task) => task.taskId === taskId);
  return found?.independentGraderPass ?? { met: 0, total: 0 };
}

function holdoutExpectedOutcome(
  result: EvalResult,
  taskId: string,
): { met: number; total: number } {
  const runs = result.runs.filter(
    (run) =>
      run.identity.evaluationRole === "holdout" &&
      run.identity.taskId === taskId,
  );
  return {
    met: runs.filter((run) => run.outcome.expectedOutcomeMet).length,
    total: runs.length,
  };
}

function capabilityRegressionFree(result: EvalResult): boolean {
  const capabilityRuns = result.runs.filter((run) => {
    const entry = requireCatalogEntry(run.identity.taskId);
    return entry.inFixedSuite && entry.evaluationRole === "dev";
  });
  if (capabilityRuns.length === 0) {
    return false;
  }
  return capabilityRuns.every((run) => run.outcome.expectedOutcomeMet);
}

function holdoutContamination(result: EvalResult): string[] {
  return result.runs
    .filter((run) => run.identity.evaluationRole === "holdout")
    .filter((run) => run.identity.contaminationStatus !== "fresh_holdout")
    .map(
      (run) =>
        `${run.identity.taskId}:${run.identity.contaminationStatus}`,
    );
}

function qualificationProvenanceIssues(input: QualificationInput): string[] {
  const issues: string[] = [];
  const runs = input.evalResult.runs;
  const revisions = unique(
    runs
      .map((run) => run.identity.baseRevision)
      .filter((value): value is string => Boolean(value)),
  );
  const models = unique(
    runs
      .map((run) => run.identity.configuredModel)
      .filter((value): value is string => Boolean(value)),
  );

  if (runs.some((run) => !run.identity.baseRevision)) {
    issues.push("qualification provenance invalid: missing baseRevision on one or more runs");
  } else if (revisions.length !== 1) {
    issues.push(
      `qualification provenance invalid: mixed baseRevision values (${revisions.join(", ") || "none"})`,
    );
  }

  const expectedBase = input.expectedBaseRevision?.trim();
  if (
    expectedBase &&
    revisions.length === 1 &&
    revisions[0] !== expectedBase
  ) {
    issues.push(
      `qualification baseRevision drift: expected ${expectedBase}, observed ${revisions[0]}`,
    );
  }

  if (runs.some((run) => !run.identity.configuredModel)) {
    issues.push("qualification provenance invalid: missing configured model on one or more runs");
  } else if (models.length !== 1) {
    issues.push(
      `qualification provenance invalid: mixed configured model values (${models.join(", ") || "none"})`,
    );
  }

  const expectedModel = input.expectedModel?.trim();
  if (expectedModel && models.length === 1 && models[0] !== expectedModel) {
    issues.push(
      `model snapshot drift: expected ${expectedModel}, observed ${models[0]}`,
    );
  }

  const configuredModel = input.configuredModel?.trim();
  if (
    configuredModel &&
    models.length === 1 &&
    models[0] !== configuredModel
  ) {
    issues.push(
      `configured model provenance mismatch: runner ${configuredModel}, runs ${models[0]}`,
    );
  }

  return issues;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
