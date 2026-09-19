import type { Spec } from "./spec.ts";
import { persistReviewBaseline } from "./review-baseline.ts";
import { snapshotDirectory, type FileSnapshot } from "./diff.ts";
import {
  admitImplementationReady,
  admitReviewReady,
  admitTerminal,
  type DurableWorkspace,
} from "./workflow-state.ts";
import {
  initializeWorkflow,
  saveWorkflowStateUnfenced,
} from "./workflow-store.ts";

export function seedSuccessfulTerminalWorkflow(options: {
  storeDir: string;
  workflowId: string;
  task: string;
  spec: Spec;
  workspace: DurableWorkspace;
  baseline: FileSnapshot;
}): { reviewBaseline: ReturnType<typeof persistReviewBaseline> } {
  const specRequired = initializeWorkflow({
    storeDir: options.storeDir,
    workflowId: options.workflowId,
    task: options.task,
    workspace: options.workspace,
  });
  const implementationReady = admitImplementationReady({
    current: specRequired,
    decision: { status: "executable", spec: options.spec },
    specInspectedPaths: { readFiles: [], listedPaths: [] },
    contextMode: "variant",
  });
  saveWorkflowStateUnfenced(options.storeDir, implementationReady);
  const reviewBaseline = persistReviewBaseline(
    options.storeDir,
    options.workflowId,
    options.baseline,
  );
  const reviewReady = admitReviewReady({
    current: implementationReady,
    workspace: options.workspace,
    reviewBaseline,
    verification: {
      passed: true,
      exitCode: 0,
      durationMs: 1,
      attempt: 1,
    },
  });
  saveWorkflowStateUnfenced(options.storeDir, reviewReady);
  saveWorkflowStateUnfenced(
    options.storeDir,
    admitTerminal({
      current: reviewReady,
      outcome: { workflowStatus: "success" },
    }),
  );
  return { reviewBaseline };
}

export function snapshotSrc(workspaceRoot: string): FileSnapshot {
  return snapshotDirectory(
    `${workspaceRoot.replace(/\/$/, "")}/target-app/src`,
  );
}
