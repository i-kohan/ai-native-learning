import {
  evaluationRoleOf,
  isEscalationTask,
  isExecutableCapabilityTask,
  isFixedSuiteTask,
  requireCatalogEntry,
  taskKindOf,
} from "./catalog.ts";
import { formatEvalReport } from "./report.ts";
import { numericSummary } from "./trials.ts";
import { EVIDENCE_GUIDED_REPAIR_SKILL_ID } from "../skills.ts";
import type { IsolationProbeResult } from "../iso01.ts";
import type { SecurityProbeResult } from "../sec01.ts";
import {
  QUALIFICATION_SUITE_VERSION,
  SUITE_VERSION,
  type CapabilityEval,
  type EvalResult,
  type HoldoutEval,
  type HoldoutTaskEval,
  type IsolationEval,
  type MethodologyProvenance,
  type ProbeEval,
  type Ratio,
  type RecurringFinding,
  type RunMetrics,
  type SecurityEval,
} from "./types.ts";

export function aggregateRuns(
  runs: RunMetrics[],
  options?: {
    isolation?: IsolationProbeResult;
    security?: SecurityProbeResult;
    suiteVersion?: string;
  },
): EvalResult {
  const capabilityRuns = runs.filter(isFixedCapabilityRun);
  const holdoutRuns = runs.filter(
    (run) => run.identity.evaluationRole === "holdout",
  );
  const fixedSuiteRuns = runs.filter((run) =>
    isFixedSuiteTask(run.identity.taskId),
  );
  const capability = capabilityEval(capabilityRuns);
  const holdout = holdoutEval(holdoutRuns);
  const probes = probeEval(runs);
  const isolation = isolationEval(options?.isolation);
  const security = securityEval(options?.security);
  const recurringFindings = recurringFindingAggregation(runs);
  const regressions = hardRegressions(
    runs,
    options?.isolation,
    options?.security,
  );
  const diagnostics = diagnosticWarnings(runs, recurringFindings);
  const methodology = methodologyProvenance(runs, options?.suiteVersion);

  const evalResult: EvalResult = {
    suiteVersion: options?.suiteVersion ?? SUITE_VERSION,
    runCount: runs.length,
    allFixedContracts: ratio(fixedSuiteRuns, (run) => run.outcome.expectedOutcomeMet),
    capability,
    holdout,
    probes,
    isolation,
    security,
    methodology,
    recurringFindings,
    regressions,
    diagnostics,
    runs,
    report: "",
  };
  evalResult.report = formatEvalReport(evalResult);
  return evalResult;
}

function isFixedCapabilityRun(run: RunMetrics): boolean {
  const entry = requireCatalogEntry(run.identity.taskId);
  return (
    entry.evaluationRole === "dev" &&
    entry.taskKind === "capability_regression" &&
    entry.inFixedSuite
  );
}

function capabilityEval(runs: RunMetrics[]): CapabilityEval {
  const executable = runs.filter((run) =>
    isExecutableCapabilityTask(run.identity.taskId),
  );
  const escalation = runs.filter((run) =>
    isEscalationTask(run.identity.taskId),
  );

  return {
    expectedOutcomesMet: ratio(runs, (run) => run.outcome.expectedOutcomeMet),
    executableTaskCount: executable.length,
    firstPassSuccess: ratio(
      executable,
      (run) => run.outcome.firstPassSuccess === true,
    ),
    eventualSuccess: ratio(
      executable,
      (run) => run.outcome.eventualSuccess === true,
    ),
    recoveredSuccess: ratio(
      executable,
      (run) => run.outcome.recoveredSuccess === true,
    ),
    correctEscalations: ratio(
      escalation,
      (run) => run.outcome.expectedOutcomeMet,
    ),
    autonomousCompletion: ratio(
      runs,
      (run) => run.outcome.autonomousCompletion,
    ),
    humanEscalation: ratio(runs, (run) => run.outcome.humanEscalation),
    knownEscapedDefects: {
      count: runs.filter((run) => run.outcome.escapedDefect === true).length,
      independentGroundTruthRuns: runs.filter(
        (run) => run.outcome.escapedDefect !== null,
      ).length,
    },
  };
}

function holdoutEval(runs: RunMetrics[]): HoldoutEval {
  const byTask = new Map<string, RunMetrics[]>();
  for (const run of runs) {
    const list = byTask.get(run.identity.taskId) ?? [];
    list.push(run);
    byTask.set(run.identity.taskId, list);
  }

  const tasks: HoldoutTaskEval[] = [...byTask.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([taskId, trialRuns]) => holdoutTaskEval(taskId, trialRuns));

  return {
    tasks,
    independentGraderPass: ratio(
      runs,
      (run) => run.outcome.grader.passed === true,
    ),
    escapedDefects: {
      met: runs.filter((run) => run.outcome.escapedDefect === true).length,
      total: runs.filter((run) => run.outcome.escapedDefect !== null).length,
    },
  };
}

function holdoutTaskEval(
  taskId: string,
  runs: RunMetrics[],
): HoldoutTaskEval {
  return {
    taskId,
    evaluationRole: "holdout",
    contaminationStatus:
      runs[0]?.identity.contaminationStatus ??
      requireCatalogEntry(taskId).contaminationStatus,
    trials: runs.length,
    independentGraderPass: ratio(
      runs,
      (run) => run.outcome.grader.passed === true,
    ),
    escapedDefects: {
      met: runs.filter((run) => run.outcome.escapedDefect === true).length,
      total: runs.filter((run) => run.outcome.escapedDefect !== null).length,
    },
    efficiency: {
      wallTimeMs: numericSummary(runs.map((run) => run.efficiency.wallTimeMs)),
      modelCalls: numericSummary(runs.map((run) => run.efficiency.modelCalls)),
      toolCalls: numericSummary(runs.map((run) => run.efficiency.toolCalls)),
      inputTokens: numericSummary(runs.map((run) => run.efficiency.inputTokens)),
      outputTokens: numericSummary(
        runs.map((run) => run.efficiency.outputTokens),
      ),
    },
    trialRunIds: runs.map((run) => run.identity.runId),
  };
}

function probeEval(runs: RunMetrics[]): ProbeEval {
  const probes: ProbeEval = {};
  for (const run of runs) {
    if (evaluationRoleOf(run.identity.taskId) !== "probe") {
      continue;
    }
    if (
      run.identity.taskId === "R01" &&
      run.probe?.mechanism === "verification_repair"
    ) {
      probes.R01 = {
        mechanism: "verification_repair",
        passed: run.probe.succeeded,
      };
    }
    if (
      run.identity.taskId === "REV01" &&
      run.probe?.mechanism === "independent_review_repair"
    ) {
      probes.REV01 = {
        mechanism: "independent_review_repair",
        passed: run.probe.succeeded,
      };
    }
  }
  return probes;
}

function recurringFindingAggregation(runs: RunMetrics[]): RecurringFinding[] {
  const byKey = new Map<string, RecurringFinding>();

  for (const run of runs) {
    for (const finding of run.review.findings) {
      const compositeKey = `${finding.findingKey}\0${finding.category}`;
      const existing = byKey.get(compositeKey) ?? {
        findingKey: finding.findingKey,
        category: finding.category,
        observed: 0,
        acceptedBlocking: 0,
        acceptedNonBlocking: 0,
        rejected: 0,
        repeatedAfterRepair: 0,
      };
      existing.observed += 1;
      if (finding.decision === "accepted_blocking") {
        existing.acceptedBlocking += 1;
      } else if (finding.decision === "accepted_non_blocking") {
        existing.acceptedNonBlocking += 1;
      } else {
        existing.rejected += 1;
      }
      if (finding.repeatedAfterRepair) {
        existing.repeatedAfterRepair += 1;
      }
      byKey.set(compositeKey, existing);
    }
  }

  return [...byKey.values()].sort(
    (left, right) =>
      right.observed - left.observed ||
      left.findingKey.localeCompare(right.findingKey) ||
      left.category.localeCompare(right.category),
  );
}

function isolationEval(result?: IsolationProbeResult): IsolationEval {
  if (!result) {
    return {};
  }
  return {
    ISO01: {
      mechanism: "workspace_isolation",
      passed: result.passed,
    },
  };
}

function securityEval(result?: SecurityProbeResult): SecurityEval {
  if (!result) {
    return {};
  }
  return {
    SEC01: {
      mechanism: "verification_secret_isolation",
      passed: result.passed,
    },
  };
}

function methodologyProvenance(
  runs: RunMetrics[],
  suiteVersion?: string,
): MethodologyProvenance {
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
  return {
    suiteVersion: suiteVersion ?? SUITE_VERSION,
    qualificationSuiteVersion: QUALIFICATION_SUITE_VERSION,
    baseRevision: revisions[0] ?? null,
    configuredModel: models[0] ?? null,
  };
}

function hardRegressions(
  runs: RunMetrics[],
  isolation?: IsolationProbeResult,
  security?: SecurityProbeResult,
): string[] {
  const regressions: string[] = [];
  if (isolation && !isolation.passed) {
    regressions.push("ISO01: workspace-isolation mechanism contract failed");
  }
  if (security && !security.passed) {
    regressions.push(
      "SEC01: verification-secret-isolation mechanism contract failed",
    );
  }

  for (const run of runs) {
    const { taskId } = run.identity;
    if (
      isFixedCapabilityRun(run) &&
      !run.outcome.expectedOutcomeMet
    ) {
      if (taskId === "T04") {
        regressions.push(
          `${taskId}: no longer correctly escalates before implementation`,
        );
      } else {
        regressions.push(`${taskId}: expected capability outcome not met`);
      }
    }
    if (run.outcome.escapedDefect === true) {
      regressions.push(`${taskId}: known escaped defect`);
    }
    if (taskId === "R01" && run.probe && !run.probe.succeeded) {
      regressions.push("R01: verification-repair mechanism contract failed");
    }
    if (taskId === "REV01" && run.probe && !run.probe.succeeded) {
      regressions.push(
        "REV01: independent-review-repair mechanism contract failed",
      );
    }
  }

  return regressions;
}

function diagnosticWarnings(
  runs: RunMetrics[],
  recurringFindings: RecurringFinding[],
): string[] {
  const diagnostics: string[] = [];

  for (const run of runs) {
    diagnostics.push(...skillLoadDiagnostics(run));
    if (
      isExecutableCapabilityTask(run.identity.taskId) &&
      run.outcome.recoveredSuccess
    ) {
      diagnostics.push(
        `${run.identity.taskId}: eventual success required harness recovery (not a correctness regression)`,
      );
    }
    if (run.review.rejected > 0) {
      diagnostics.push(
        `${run.identity.taskId}: ${run.review.rejected} rejected reviewer finding(s) (policy decision, not precision)`,
      );
    }
  }

  for (const finding of recurringFindings) {
    if (finding.observed > 1) {
      diagnostics.push(
        `recurring finding candidate ${finding.findingKey} (${finding.category}) observed ${finding.observed} times — human review, not auto-promotion`,
      );
    }
  }

  return diagnostics;
}

function skillLoadDiagnostics(run: RunMetrics): string[] {
  const { taskId } = run.identity;
  const loads = run.skills.loads;

  if (
    evaluationRoleOf(taskId) === "dev" &&
    taskKindOf(taskId) === "capability_regression"
  ) {
    if (loads.length === 0) {
      return [];
    }
    return [`${taskId}: unexpected skill load (${formatLoads(loads)})`];
  }

  if (taskId === "R01") {
    const unexpected = loads.filter((item) => item.phase !== "repair");
    if (!hasSkill(loads, EVIDENCE_GUIDED_REPAIR_SKILL_ID, "repair")) {
      return ["R01: expected evidence-guided-repair for repair"];
    }
    if (unexpected.length > 0) {
      return [`R01: unexpected skill phase (${formatLoads(unexpected)})`];
    }
    return [];
  }

  if (taskId === "REV01") {
    const unexpected = loads.filter((item) => item.phase !== "review_repair");
    if (!hasSkill(loads, EVIDENCE_GUIDED_REPAIR_SKILL_ID, "review_repair")) {
      return ["REV01: expected evidence-guided-repair for review_repair"];
    }
    if (unexpected.length > 0) {
      return [`REV01: unexpected skill phase (${formatLoads(unexpected)})`];
    }
  }

  return [];
}

function hasSkill(
  loads: RunMetrics["skills"]["loads"],
  skillId: string,
  phase: string,
): boolean {
  return loads.some((item) => item.skillId === skillId && item.phase === phase);
}

function formatLoads(loads: RunMetrics["skills"]["loads"]): string {
  return loads.map((item) => `${item.skillId}@${item.phase}`).join(", ");
}

function ratio(
  runs: RunMetrics[],
  predicate: (run: RunMetrics) => boolean,
): Ratio {
  return {
    met: runs.filter(predicate).length,
    total: runs.length,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
