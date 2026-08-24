import type {
  EvalResult,
  IsolationEval,
  ProbeEval,
  Ratio,
  SecurityEval,
} from "./types.ts";

export function formatEvalReport(result: EvalResult): string {
  const cap = result.capability;
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
    `All fixed benchmark contracts  ${formatRatio(result.allFixedContracts)}`,
    "(qualified: capability expected outcomes + probe contracts, not an overall success rate)",
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
  return `${run.identity.taskId}  ${run.identity.taskKind}${run.identity.mechanism ? `/${run.identity.mechanism}` : ""}  expected=${run.outcome.expectedOutcomeMet ? "yes" : "no"}  first_pass=${firstPass}  autonomous=${run.outcome.autonomousCompletion}  escalate=${run.outcome.humanEscalation}  verify=${run.recovery.verificationSequence.join("→") || "n/a"}  ${skills}${probe}`;
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
