import { formatCount, formatMedianRange } from "./trials.ts";
import {
  QUALIFICATION_SUITE_VERSION,
  type EvalResult,
  type HoldoutTaskEval,
  type IsolationEval,
  type ProbeEval,
  type QualificationVerdict,
  type Ratio,
  type SecurityEval,
} from "./types.ts";
import type { QualificationDecision } from "./qualify.ts";

export function formatEvalReport(result: EvalResult): string {
  const cap = result.capability;
  const qualification = result.suiteVersion === QUALIFICATION_SUITE_VERSION;
  const fixedContractsLabel = qualification
    ? "DEV capability contracts"
    : "All fixed benchmark contracts";
  const fixedContractsNote = qualification
    ? "(qualification denominator: T01–T04 DEV capability contracts only; R01/REV01 are not run here)"
    : "(qualified: capability expected outcomes + probe contracts, not an overall success rate)";

  const lines = [
    `=== Eval Report (${result.suiteVersion}) ===`,
    "",
    "Capability / Regression",
    formatRow("Expected outcomes", cap.expectedOutcomesMet),
    `Executable tasks        ${cap.executableTaskCount}`,
    formatRow("First-pass success", cap.firstPassSuccess),
    formatRow("Eventual success", cap.eventualSuccess),
    formatRow("Recovered success", cap.recoveredSuccess),
    formatRow("Correct escalations", cap.correctEscalations),
    formatRow("Autonomous completion", cap.autonomousCompletion),
    formatRow("Human escalation", cap.humanEscalation),
    `Known escaped defects   ${formatEscapedDefects(cap.knownEscapedDefects)}`,
    "",
    "Holdout",
    ...formatHoldoutSection(result),
    "",
    "Mechanism probes",
    formatProbe("R01 verification repair", result.probes.R01),
    formatProbe("REV01 independent review", result.probes.REV01),
    "",
    "Isolation",
    formatIsolation("ISO01 workspace isolation", result.isolation.ISO01),
    "(not included in capability first-pass / task-success denominators)",
    "",
    "Security",
    formatSecurity(
      "SEC01 verification secret isolation",
      result.security.SEC01,
    ),
    "(not included in capability first-pass / task-success denominators)",
    "",
    "Skills",
    ...result.runs.map(formatSkillLine),
    "",
    `${fixedContractsLabel}  ${formatRatio(result.allFixedContracts)}`,
    fixedContractsNote,
    "",
    "Methodology",
    `suite=${result.methodology.suiteVersion} qualification=${result.methodology.qualificationSuiteVersion}`,
    `baseRevision=${result.methodology.baseRevision ?? "n/a"}`,
    `configuredModel=${result.methodology.configuredModel ?? "n/a"}`,
    "",
    "Hard regressions",
    ...(result.regressions.length
      ? result.regressions.map((item) => `- ${item}`)
      : ["- (none)"]),
    "",
    "Diagnostics (not correctness regressions)",
    ...(result.diagnostics.length
      ? result.diagnostics.map((item) => `- ${item}`)
      : ["- (none)"]),
    "",
    "Per-run",
    ...result.runs.map(formatRunLine),
  ];

  const recurring = result.recurringFindings.filter(
    (finding) => finding.observed > 1,
  );
  if (recurring.length) {
    lines.push("", "Recurring findings (candidates for human review)");
    for (const finding of recurring) {
      lines.push(
        `- ${finding.findingKey} [${finding.category}] observed=${finding.observed} blocking=${finding.acceptedBlocking} non_blocking=${finding.acceptedNonBlocking} rejected=${finding.rejected} repeated_after_repair=${finding.repeatedAfterRepair}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatQualificationReport(
  result: EvalResult,
  decision: QualificationDecision,
): string {
  const lines = [
    result.report,
    "",
    "=== Qualification ===",
    `claim: ${decision.claim}`,
    `verdict: ${formatVerdict(decision.verdict)}`,
    `claimSupported: ${decision.claimSupported ? "yes" : "no"}`,
    `T01–T04 regression-free: ${decision.t01t04RegressionFree ? "yes" : "no"}`,
    `H01 full expected outcome: ${formatCount(decision.h01ExpectedOutcome)}`,
    `H01 independent grader: ${formatCount(decision.h01IndependentGrader)}`,
    `H02 full expected outcome: ${formatCount(decision.h02ExpectedOutcome)}`,
    `H02 independent grader: ${formatCount(decision.h02IndependentGrader)}`,
    `escaped defects: ${decision.escapedDefects}`,
    `calibration: ${decision.calibrationValid ? "valid" : "invalid"}`,
    "",
    "Decision rule",
    decision.decisionRule,
    "",
    "Reasons",
    ...decision.reasons.map((item) => `- ${item}`),
    "",
    "Do not read 3/3 as 100% reliability. Counts are observed on this frozen workload and model snapshot.",
  ];
  return lines.join("\n");
}

function formatHoldoutSection(result: EvalResult): string[] {
  if (result.holdout.tasks.length === 0) {
    return [
      "(not in this eval)",
      "(DEV / HOLDOUT / probe denominators are not mixed)",
    ];
  }

  const lines = [
    `Independent grader pass  ${formatRatio(result.holdout.independentGraderPass)}`,
    `Escaped defects          ${formatEscapedDefects({
      count: result.holdout.escapedDefects.met,
      independentGroundTruthRuns: result.holdout.escapedDefects.total,
    })}`,
    "(observed counts only; not a reliability percentage)",
  ];
  for (const task of result.holdout.tasks) {
    lines.push(...formatHoldoutTask(task));
  }
  return lines;
}

function formatHoldoutTask(task: HoldoutTaskEval): string[] {
  return [
    "",
    `${task.taskId}  role=${task.evaluationRole}  contamination=${task.contaminationStatus}  trials=${task.trials}`,
    `  independent grader     ${formatCount(task.independentGraderPass)}`,
    `  escaped defects        ${formatCount(task.escapedDefects)}`,
    `  wallTimeMs             ${formatMedianRange(task.efficiency.wallTimeMs)}`,
    `  modelCalls             ${formatMedianRange(task.efficiency.modelCalls)}`,
    `  toolCalls              ${formatMedianRange(task.efficiency.toolCalls)}`,
    `  inputTokens            ${formatMedianRange(task.efficiency.inputTokens)}`,
    `  outputTokens           ${formatMedianRange(task.efficiency.outputTokens)}`,
    `  raw trials             ${task.trialRunIds.join(", ") || "(none)"}`,
  ];
}

function formatVerdict(verdict: QualificationVerdict): string {
  return verdict;
}

function formatRow(label: string, value: Ratio): string {
  return `${label.padEnd(22)} ${formatRatio(value)}`;
}

function formatRatio(value: Ratio): string {
  return `${value.met} / ${value.total}`;
}

function formatEscapedDefects(value: {
  count: number;
  independentGroundTruthRuns: number;
}): string {
  if (value.independentGroundTruthRuns === 0) {
    return "n/a (grader = harness VERIFY; no independent ground truth)";
  }
  return `${value.count} / ${value.independentGroundTruthRuns}`;
}

function formatIsolation(label: string, probe: IsolationEval["ISO01"]): string {
  const padded = label.padEnd(28);
  if (!probe) {
    return `${padded} (not in this eval)`;
  }
  return `${padded} ${probe.passed ? "PASS" : "FAIL"}`;
}

function formatSecurity(label: string, probe: SecurityEval["SEC01"]): string {
  const padded = label.padEnd(40);
  if (!probe) {
    return `${padded} (not in this eval)`;
  }
  return `${padded} ${probe.passed ? "PASS" : "FAIL"}`;
}

function formatProbe(
  label: string,
  probe: ProbeEval["R01"] | ProbeEval["REV01"],
): string {
  const padded = label.padEnd(28);
  if (!probe) {
    return `${padded} (not in this eval)`;
  }
  return `${padded} ${probe.passed ? "PASS" : "FAIL"}`;
}

function formatRunLine(run: EvalResult["runs"][number]): string {
  const firstPass =
    run.outcome.firstPassSuccess === null
      ? "n/a"
      : run.outcome.firstPassSuccess
        ? "yes"
        : "no";
  const probe =
    run.probe?.mechanism === "independent_review_repair"
      ? ` intended=${run.probe.intendedFindingDetected} unexpected_blocking=${run.probe.unexpectedBlockingFindings}`
      : run.probe?.mechanism === "verification_repair"
        ? ` controlled_fail=${run.probe.controlledFailureTriggered}`
        : "";
  const skills =
    run.skills.loads.length === 0
      ? "skills=none"
      : `skills=${run.skills.loads
          .map((item) => `${item.skillId}@${item.phase}`)
          .join(",")}`;
  const grader = run.outcome.grader.independentOfHarnessVerify
    ? ` independent_grader=${run.outcome.grader.passed ? "PASS" : "FAIL"} escaped=${run.outcome.escapedDefect}`
    : "";
  return `${run.identity.taskId}  ${run.identity.evaluationRole}/${run.identity.taskKind}${run.identity.mechanism ? `/${run.identity.mechanism}` : ""}  trial=${run.identity.trialIndex}/${run.identity.trialCount}  expected=${run.outcome.expectedOutcomeMet ? "yes" : "no"}  first_pass=${firstPass}  autonomous=${run.outcome.autonomousCompletion}  escalate=${run.outcome.humanEscalation}  verify=${run.recovery.verificationSequence.join("→") || "n/a"}  ${skills}${probe}${grader}`;
}

function formatSkillLine(run: EvalResult["runs"][number]): string {
  if (run.skills.loads.length === 0) {
    return `${run.identity.taskId.padEnd(5)} (none)`;
  }
  return run.skills.loads
    .map(
      (item) =>
        `${run.identity.taskId.padEnd(5)} ${item.skillId}@${item.phase} ${item.contentHash}`,
    )
    .join("\n");
}
