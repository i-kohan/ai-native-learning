import {
  SUITE_VERSION,
  type CatalogTaskId,
  type ContaminationStatus,
  type EvaluationRole,
  type FixedTaskId,
  type Mechanism,
  type RunIdentity,
  type TaskKind,
} from "./types.ts";

export type TaskCatalogEntry = {
  taskId: CatalogTaskId;
  evaluationRole: EvaluationRole;
  taskKind: TaskKind;
  mechanism?: Mechanism;
  contaminationStatus: ContaminationStatus;
  graderIndependentOfHarnessVerify: boolean;
  defaultTrialCount: number;
  inFixedSuite: boolean;
};

const ENTRIES: TaskCatalogEntry[] = [
  entry("T01", "dev", "capability_regression", {
    inFixedSuite: true,
    defaultTrialCount: 1,
  }),
  entry("T02", "dev", "capability_regression", {
    inFixedSuite: true,
    defaultTrialCount: 1,
  }),
  entry("T03", "dev", "capability_regression", {
    inFixedSuite: true,
    defaultTrialCount: 1,
  }),
  entry("T04", "dev", "capability_regression", {
    inFixedSuite: true,
    defaultTrialCount: 1,
  }),
  entry("P01", "dev", "capability_regression", {
    defaultTrialCount: 3,
  }),
  entry("P02", "dev", "capability_regression", {
    defaultTrialCount: 3,
  }),
  entry("H01", "holdout", "capability_regression", {
    contaminationStatus: "fresh_holdout",
    graderIndependentOfHarnessVerify: true,
    defaultTrialCount: 3,
  }),
  entry("H02", "holdout", "capability_regression", {
    contaminationStatus: "fresh_holdout",
    graderIndependentOfHarnessVerify: true,
    defaultTrialCount: 3,
  }),
  entry("R01", "probe", "mechanism_probe", {
    mechanism: "verification_repair",
    inFixedSuite: true,
  }),
  entry("REV01", "probe", "mechanism_probe", {
    mechanism: "independent_review_repair",
    inFixedSuite: true,
  }),
  entry("ISO01", "isolation", "mechanism_probe"),
  entry("SEC01", "security", "mechanism_probe"),
  entry("DUR01", "probe", "mechanism_probe"),
];

const BY_ID = new Map(ENTRIES.map((item) => [item.taskId, item]));

export const TASK_CATALOG: readonly TaskCatalogEntry[] = ENTRIES;

export function catalogEntry(taskId: string): TaskCatalogEntry | undefined {
  return BY_ID.get(taskId);
}

export function requireCatalogEntry(taskId: string): TaskCatalogEntry {
  const found = catalogEntry(taskId);
  if (!found) {
    throw new Error(`Unknown catalog task: ${taskId}`);
  }
  return found;
}

export function isCatalogTaskId(value: string): boolean {
  return BY_ID.has(value);
}

export function isFixedTaskId(value: string): value is FixedTaskId {
  const found = catalogEntry(value);
  return found?.inFixedSuite === true && found.evaluationRole !== "holdout";
}

export function taskKindOf(taskId: string): TaskKind {
  return requireCatalogEntry(taskId).taskKind;
}

export function evaluationRoleOf(taskId: string): EvaluationRole {
  return requireCatalogEntry(taskId).evaluationRole;
}

export function mechanismOf(taskId: string): Mechanism | undefined {
  return catalogEntry(taskId)?.mechanism;
}

export function isEscalationTask(taskId: string): boolean {
  return taskId === "T04";
}

export function isExecutableCapabilityTask(taskId: string): boolean {
  return (
    evaluationRoleOf(taskId) === "dev" &&
    taskKindOf(taskId) === "capability_regression" &&
    requireCatalogEntry(taskId).inFixedSuite &&
    !isEscalationTask(taskId)
  );
}

export function isHoldoutTask(taskId: string): boolean {
  return evaluationRoleOf(taskId) === "holdout";
}

export function isFixedSuiteTask(taskId: string): boolean {
  return requireCatalogEntry(taskId).inFixedSuite;
}

export function markHoldoutContaminated(taskId: string): TaskCatalogEntry {
  const found = requireCatalogEntry(taskId);
  if (found.evaluationRole !== "holdout") {
    throw new Error(`${taskId} is not a holdout task`);
  }
  return {
    ...found,
    evaluationRole: "dev",
    contaminationStatus: "contaminated_now_dev",
    graderIndependentOfHarnessVerify: found.graderIndependentOfHarnessVerify,
  };
}

export function runIdentity(options: {
  runId: string;
  taskId: string;
  trialIndex?: number;
  trialCount?: number;
  suiteVersion?: string;
  baseRevision?: string | null;
  configuredModel?: string | null;
  contaminationStatus?: ContaminationStatus;
}): RunIdentity {
  const entry = requireCatalogEntry(options.taskId);
  return {
    runId: options.runId,
    taskId: entry.taskId,
    taskKind: entry.taskKind,
    evaluationRole: entry.evaluationRole,
    ...(entry.mechanism ? { mechanism: entry.mechanism } : {}),
    suiteVersion: options.suiteVersion ?? SUITE_VERSION,
    trialIndex: options.trialIndex ?? 1,
    trialCount: options.trialCount ?? entry.defaultTrialCount,
    contaminationStatus:
      options.contaminationStatus ?? entry.contaminationStatus,
    baseRevision: options.baseRevision ?? null,
    configuredModel: options.configuredModel ?? null,
  };
}

function entry(
  taskId: CatalogTaskId,
  evaluationRole: EvaluationRole,
  taskKind: TaskKind,
  extras: Partial<
    Omit<TaskCatalogEntry, "taskId" | "evaluationRole" | "taskKind">
  > = {},
): TaskCatalogEntry {
  return {
    taskId,
    evaluationRole,
    taskKind,
    contaminationStatus: extras.contaminationStatus ?? "not_applicable",
    graderIndependentOfHarnessVerify:
      extras.graderIndependentOfHarnessVerify ?? false,
    defaultTrialCount: extras.defaultTrialCount ?? 1,
    inFixedSuite: extras.inFixedSuite ?? false,
    ...(extras.mechanism ? { mechanism: extras.mechanism } : {}),
  };
}
