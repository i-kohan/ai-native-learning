import type { WorkflowFailureReason, WorkflowStatus } from "../run.ts";
import type { FindingDecisionKind, FindingSeverity } from "../review.ts";
import type { SkillLoadRecord } from "../skills.ts";
import type { SpecDecision } from "../spec.ts";

export const SUITE_VERSION = "fixed-v3-m09";
export const QUALIFICATION_SUITE_VERSION = "qualification-m15";

export const CAPABILITY_TASK_IDS = ["T01", "T02", "T03", "T04"] as const;
export const EXECUTABLE_CAPABILITY_TASK_IDS = ["T01", "T02", "T03"] as const;
export const PROBE_TASK_IDS = ["R01", "REV01"] as const;
export const HOLDOUT_TASK_IDS = ["H01", "H02"] as const;
export const KNOWN_WORKLOAD_TASK_IDS = ["P01", "P02"] as const;
export const FIXED_SUITE_TASK_IDS = [
  ...CAPABILITY_TASK_IDS,
  ...PROBE_TASK_IDS,
] as const;

export type CapabilityTaskId = (typeof CAPABILITY_TASK_IDS)[number];
export type ExecutableCapabilityTaskId =
  (typeof EXECUTABLE_CAPABILITY_TASK_IDS)[number];
export type ProbeTaskId = (typeof PROBE_TASK_IDS)[number];
export type HoldoutTaskId = (typeof HOLDOUT_TASK_IDS)[number];
export type KnownWorkloadTaskId = (typeof KNOWN_WORKLOAD_TASK_IDS)[number];
export type FixedTaskId = (typeof FIXED_SUITE_TASK_IDS)[number];
export type CatalogTaskId = string;

export type EvaluationRole =
  | "dev"
  | "holdout"
  | "probe"
  | "isolation"
  | "security";

export type TaskKind = "capability_regression" | "mechanism_probe";
export type Mechanism = "verification_repair" | "independent_review_repair";
export type VerificationOutcome = "PASS" | "FAIL";
export type ContaminationStatus =
  | "fresh_holdout"
  | "contaminated_now_dev"
  | "not_applicable";
export type GraderProvenanceKind =
  | "harness_verify"
  | "benchmark_owned_independent"
  | "none";

export type QualificationVerdict =
  | "supported"
  | "unsupported"
  | "inconclusive"
  | "regression"
  | "candidate";

export type RunIdentity = {
  runId: string;
  taskId: CatalogTaskId;
  taskKind: TaskKind;
  evaluationRole: EvaluationRole;
  mechanism?: Mechanism;
  suiteVersion: string;
  trialIndex: number;
  trialCount: number;
  contaminationStatus: ContaminationStatus;
  baseRevision: string | null;
  configuredModel: string | null;
};

export type GraderProvenance = {
  name: string;
  passed: boolean | null;
  independentOfHarnessVerify: boolean;
  provenance: GraderProvenanceKind;
};

export type OutcomeMetrics = {
  expectedOutcomeMet: boolean;
  workflowStatus: WorkflowStatus;
  failureReason?: WorkflowFailureReason;
  /** Not classified automatically. Null unless explicit evidence exists. */
  failureLayer: null;
  autonomousCompletion: boolean;
  humanEscalation: boolean;
  specDecision: SpecDecision["status"] | null;
  implementationStarted: boolean;
  /** Null when the metric is not applicable (T04 / no implementation expected). */
  firstPassSuccess: boolean | null;
  eventualSuccess: boolean | null;
  recoveredSuccess: boolean | null;
  /** Null when no independent ground truth exists. Never inferred from VERIFY/REVIEW PASS. */
  escapedDefect: boolean | null;
  grader: GraderProvenance;
};

export type RecoveryMetrics = {
  firstVerificationPassed: boolean | null;
  verificationAttempts: number;
  verificationSequence: VerificationOutcome[];
  verificationRepairAttempts: number;
  repeatedFailure: boolean;
};

export type FindingSummary = {
  findingKey: string;
  category: string;
  severity: FindingSeverity;
  decision: FindingDecisionKind;
  reviewRound: number;
  repeatedAfterRepair: boolean;
};

export type ReviewMetrics = {
  reviewAttempts: number;
  reviewRepairAttempts: number;
  repeatedFinding: boolean;
  findingsObserved: number;
  acceptedBlocking: number;
  acceptedNonBlocking: number;
  rejected: number;
  findings: FindingSummary[];
};

export type PhaseEfficiency = {
  modelCalls: number;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number | null;
};

export type EfficiencyMetrics = {
  modelCalls: number;
  toolCalls: number;
  /** Spec+implementation discovery only; not a complete per-tool census. */
  repoDiscoveryToolCalls: {
    list_files: number;
    read_file: number;
  };
  inputTokens: number | null;
  outputTokens: number | null;
  wallTimeMs: number;
  phases: {
    spec: PhaseEfficiency;
    implementation: PhaseEfficiency;
    verification: {
      attempts: number;
      wallTimeMs: number;
    };
    repair: PhaseEfficiency;
    review: PhaseEfficiency;
    review_repair: PhaseEfficiency;
  };
};

export type VerificationRepairProbe = {
  mechanism: "verification_repair";
  succeeded: boolean;
  controlledFailureTriggered: boolean;
};

export type IndependentReviewRepairProbe = {
  mechanism: "independent_review_repair";
  succeeded: boolean;
  intendedFindingDetected: boolean;
  unexpectedBlockingFindings: number;
};

export type ProbeMetrics =
  | VerificationRepairProbe
  | IndependentReviewRepairProbe;

export type SkillMetrics = {
  loads: SkillLoadRecord[];
};

export type RunMetrics = {
  identity: RunIdentity;
  outcome: OutcomeMetrics;
  recovery: RecoveryMetrics;
  review: ReviewMetrics;
  efficiency: EfficiencyMetrics;
  skills: SkillMetrics;
  probe?: ProbeMetrics;
};

export type Ratio = {
  met: number;
  total: number;
};

export type NumericSummary = {
  median: number | null;
  min: number | null;
  max: number | null;
  /** Raw per-trial values; aggregates do not replace this evidence. */
  values: Array<number | null>;
};

export type RecurringFinding = {
  findingKey: string;
  category: string;
  observed: number;
  acceptedBlocking: number;
  acceptedNonBlocking: number;
  rejected: number;
  repeatedAfterRepair: number;
};

export type CapabilityEval = {
  expectedOutcomesMet: Ratio;
  executableTaskCount: number;
  firstPassSuccess: Ratio;
  eventualSuccess: Ratio;
  recoveredSuccess: Ratio;
  correctEscalations: Ratio;
  autonomousCompletion: Ratio;
  humanEscalation: Ratio;
  knownEscapedDefects: {
    count: number;
    independentGroundTruthRuns: number;
  };
};

export type HoldoutTaskEval = {
  taskId: CatalogTaskId;
  evaluationRole: "holdout";
  contaminationStatus: ContaminationStatus;
  trials: number;
  independentGraderPass: Ratio;
  escapedDefects: Ratio;
  efficiency: {
    wallTimeMs: NumericSummary;
    modelCalls: NumericSummary;
    toolCalls: NumericSummary;
    inputTokens: NumericSummary;
    outputTokens: NumericSummary;
  };
  trialRunIds: string[];
};

export type HoldoutEval = {
  tasks: HoldoutTaskEval[];
  independentGraderPass: Ratio;
  escapedDefects: Ratio;
};

export type ProbeEval = {
  R01?: { mechanism: "verification_repair"; passed: boolean };
  REV01?: { mechanism: "independent_review_repair"; passed: boolean };
};

export type IsolationEval = {
  ISO01?: { mechanism: "workspace_isolation"; passed: boolean };
};

export type SecurityEval = {
  SEC01?: { mechanism: "verification_secret_isolation"; passed: boolean };
};

export type MethodologyProvenance = {
  suiteVersion: string;
  qualificationSuiteVersion: string;
  baseRevision: string | null;
  configuredModel: string | null;
};

export type EvalResult = {
  suiteVersion: string;
  runCount: number;
  allFixedContracts: Ratio;
  capability: CapabilityEval;
  holdout: HoldoutEval;
  probes: ProbeEval;
  isolation: IsolationEval;
  security: SecurityEval;
  methodology: MethodologyProvenance;
  recurringFindings: RecurringFinding[];
  regressions: string[];
  diagnostics: string[];
  runs: RunMetrics[];
  report: string;
};

export const QUALIFICATION_CLAIM =
  "Current default harness preserves known regression contracts and correctly completes the two frozen holdout workloads under the Module 15 qualification protocol.";

export const QUALIFICATION_DECISION_RULE = [
  "Predefined Module 15 qualification rule (frozen before examining qualification outcomes):",
  `Claim: ${QUALIFICATION_CLAIM}`,
  "The claim is SUPPORTED only if all of the following hold:",
  "1. T01–T04 have no regression (each expected capability contract met).",
  "2. H01 independent grader = 3/3 PASS.",
  "3. H02 independent grader = 3/3 PASS.",
  "4. escaped defects = 0 across holdout trials with independent ground truth.",
  "5. grader calibration is valid.",
  "A holdout result such as 2/3 does NOT satisfy the rule and is unsupported, not inconclusive.",
  "Do not call a failed predefined criterion inconclusive merely because the sample size is small.",
  "Use inconclusive only when the evidence itself cannot support a clean decision: invalid trials, flaky grader, contamination, uncontrolled environment/model change, or an uncovered trade-off.",
  "Any conclusion remains workload-bounded. Never report 3/3 as 100% reliability.",
  "Holdout lifecycle: fresh holdout → evaluate → if its result is used to change/tune the evaluated harness/mechanism → it becomes DEV/known for future qualification.",
].join("\n");
