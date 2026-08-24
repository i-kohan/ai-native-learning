import type { WorkflowFailureReason, WorkflowStatus } from "../run.ts";
import type { FindingDecisionKind, FindingSeverity } from "../review.ts";
import type { SkillLoadRecord } from "../skills.ts";
import type { SpecDecision } from "../spec.ts";

export const SUITE_VERSION = "fixed-v3-m09";

export const CAPABILITY_TASK_IDS = ["T01", "T02", "T03", "T04"] as const;
export const EXECUTABLE_CAPABILITY_TASK_IDS = ["T01", "T02", "T03"] as const;
export const PROBE_TASK_IDS = ["R01", "REV01"] as const;
export const FIXED_SUITE_TASK_IDS = [
  ...CAPABILITY_TASK_IDS,
  ...PROBE_TASK_IDS,
] as const;

export type CapabilityTaskId = (typeof CAPABILITY_TASK_IDS)[number];
export type ExecutableCapabilityTaskId =
  (typeof EXECUTABLE_CAPABILITY_TASK_IDS)[number];
export type ProbeTaskId = (typeof PROBE_TASK_IDS)[number];
export type FixedTaskId = (typeof FIXED_SUITE_TASK_IDS)[number];

export type TaskKind = "capability_regression" | "mechanism_probe";
export type Mechanism = "verification_repair" | "independent_review_repair";
export type VerificationOutcome = "PASS" | "FAIL";

export type RunIdentity = {
  runId: string;
  taskId: FixedTaskId;
  taskKind: TaskKind;
  mechanism?: Mechanism;
  suiteVersion: string;
};

export type GraderProvenance = {
  name: "target-app npm test" | "none";
  passed: boolean | null;
  /** Current fixed suite reuses harness VERIFY; not an independent hidden grader. */
  independentOfHarnessVerify: false;
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

export type EvalResult = {
  suiteVersion: string;
  runCount: number;
  allFixedContracts: Ratio;
  capability: CapabilityEval;
  probes: ProbeEval;
  isolation: IsolationEval;
  security: SecurityEval;
  recurringFindings: RecurringFinding[];
  regressions: string[];
  diagnostics: string[];
  runs: RunMetrics[];
  report: string;
};
