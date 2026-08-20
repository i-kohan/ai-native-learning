import {
  SUITE_VERSION,
  type FixedTaskId,
  type Mechanism,
  type RunIdentity,
  type TaskKind,
} from "./types.ts";

const PROBE_MECHANISM: Record<
  Extract<FixedTaskId, "R01" | "REV01">,
  Mechanism
> = {
  R01: "verification_repair",
  REV01: "independent_review_repair",
};

export function isFixedTaskId(value: string): value is FixedTaskId {
  return (
    value === "T01" ||
    value === "T02" ||
    value === "T03" ||
    value === "T04" ||
    value === "R01" ||
    value === "REV01"
  );
}

export function taskKindOf(taskId: FixedTaskId): TaskKind {
  return taskId === "R01" || taskId === "REV01"
    ? "mechanism_probe"
    : "capability_regression";
}

export function mechanismOf(taskId: FixedTaskId): Mechanism | undefined {
  if (taskId === "R01" || taskId === "REV01") {
    return PROBE_MECHANISM[taskId];
  }
  return undefined;
}

export function isEscalationTask(taskId: FixedTaskId): boolean {
  return taskId === "T04";
}

export function isExecutableCapabilityTask(taskId: FixedTaskId): boolean {
  return taskId === "T01" || taskId === "T02" || taskId === "T03";
}

export function runIdentity(options: {
  runId: string;
  taskId: FixedTaskId;
}): RunIdentity {
  const mechanism = mechanismOf(options.taskId);
  return {
    runId: options.runId,
    taskId: options.taskId,
    taskKind: taskKindOf(options.taskId),
    ...(mechanism ? { mechanism } : {}),
    suiteVersion: SUITE_VERSION,
  };
}
