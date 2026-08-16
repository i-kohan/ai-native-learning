import type { HarnessConfig } from "./config.ts";
import { diffSnapshots, snapshotDirectory, type FileSnapshot } from "./diff.ts";
import { runAgentLoop, type AgentRunResult } from "./loop.ts";
import { buildSpec } from "./spec-phase.ts";
import {
  formatSpecContract,
  summarizeAmbiguities,
  writeSpecArtifact,
  type Ambiguity,
  type SpecDecision,
} from "./spec.ts";
import { Tracer } from "./trace.ts";
import type { VerificationResult } from "./verify.ts";

export type WorkflowStatus = "success" | "failure" | "needs_human_judgment";

export type HarnessRunResult = {
  task: string;
  workflowStatus: WorkflowStatus;
  failureReason?: AgentRunResult["failureReason"] | "spec_phase_failed";
  specDecision: SpecDecision | null;
  unresolvedQuestions: Ambiguity[];
  implementationStarted: boolean;
  implementation: AgentRunResult | null;
  specTurns: number;
  specModelCalls: number;
  specToolCalls: number;
  turns: number;
  modelCalls: number;
  toolCalls: number;
  receivedTerminalResponse: boolean;
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult | null;
  modelFinalResponse: string;
  changedFiles: string[];
  unifiedDiff: string;
  tracePath: string;
  specPath: string;
  durationMs: number;
};

export async function runV1Harness(options: {
  config: HarnessConfig;
  task: string;
  runId: string;
  beforeSnapshot?: FileSnapshot;
}): Promise<HarnessRunResult> {
  const { config, task, runId } = options;
  const startedAt = Date.now();
  const tracer = new Tracer(config.tracesDir, runId);
  const beforeSnapshot =
    options.beforeSnapshot ?? snapshotDirectory(config.targetSrcRoot);

  tracer.record("run_started", {
    version: "v1",
    task,
    model: config.model,
    maxTurns: config.maxTurns,
  });

  const specPhase = await buildSpec({ config, task, tracer });

  if (!specPhase.decision) {
    const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
    const { changedFiles, unifiedDiff } = diffSnapshots(
      beforeSnapshot,
      afterSnapshot,
    );
    const result = baseResult({
      task,
      workflowStatus: "failure",
      failureReason: "spec_phase_failed",
      specDecision: null,
      unresolvedQuestions: [],
      implementationStarted: false,
      implementation: null,
      specPhase,
      receivedTerminalResponse: false,
      finalVerificationPassed: false,
      finalVerification: null,
      modelFinalResponse: specPhase.modelFinalResponse,
      changedFiles,
      unifiedDiff,
      tracePath: tracer.tracePath,
      durationMs: Date.now() - startedAt,
    });
    tracer.record("harness_gate", {
      action: "abort",
      reason: specPhase.failureReason ?? "spec_phase_failed",
    });
    await finishRun(tracer, result);
    return result;
  }

  const decision = specPhase.decision;

  if (decision.status === "needs_human_judgment") {
    const afterSnapshot = snapshotDirectory(config.targetSrcRoot);
    const { changedFiles, unifiedDiff } = diffSnapshots(
      beforeSnapshot,
      afterSnapshot,
    );
    tracer.record("harness_gate", {
      action: "escalate",
      unresolvedQuestions: decision.unresolvedQuestions,
      implementationStarted: false,
    });
    const result = baseResult({
      task,
      workflowStatus: "needs_human_judgment",
      specDecision: decision,
      unresolvedQuestions: decision.unresolvedQuestions,
      implementationStarted: false,
      implementation: null,
      specPhase,
      receivedTerminalResponse: false,
      finalVerificationPassed: false,
      finalVerification: null,
      modelFinalResponse: formatEscalationMessage(decision),
      changedFiles,
      unifiedDiff,
      tracePath: tracer.tracePath,
      durationMs: Date.now() - startedAt,
    });
    await finishRun(tracer, result);
    return result;
  }

  tracer.record("harness_gate", {
    action: "execute",
    implementationStarted: true,
  });

  const implementation = await runAgentLoop({
    config,
    task: formatSpecContract(task, decision.spec),
    runId,
    beforeSnapshot,
    spec: decision.spec,
    tracer,
  });

  const result = baseResult({
    task,
    workflowStatus: implementation.status === "success" ? "success" : "failure",
    failureReason: implementation.failureReason,
    specDecision: decision,
    unresolvedQuestions: [],
    implementationStarted: true,
    implementation,
    specPhase,
    receivedTerminalResponse: implementation.receivedTerminalResponse,
    finalVerificationPassed: implementation.finalVerificationPassed,
    finalVerification: implementation.finalVerification,
    modelFinalResponse: implementation.modelFinalResponse,
    changedFiles: implementation.changedFiles,
    unifiedDiff: implementation.unifiedDiff,
    tracePath: tracer.tracePath,
    durationMs: Date.now() - startedAt,
  });
  await finishRun(tracer, result);
  return result;
}

export function printHarnessResult(result: HarnessRunResult): void {
  console.log("\n=== V1 Harness Result ===");
  console.log(`task: ${truncate(result.task, 200)}`);
  console.log(`workflow_status: ${result.workflowStatus}`);
  console.log(`spec_decision: ${result.specDecision?.status ?? "(none)"}`);
  console.log(`implementation_started: ${result.implementationStarted}`);
  if (result.failureReason) {
    console.log(`failure_reason: ${result.failureReason}`);
  }
  const ambiguities = result.specDecision
    ? summarizeAmbiguities(result.specDecision.spec)
    : [];
  console.log(
    `ambiguities: ${
      ambiguities.length
        ? ambiguities
            .map((item) => `${item.classification}/${item.status}`)
            .join(", ")
        : "(none)"
    }`,
  );
  if (result.specDecision) {
    const spec = result.specDecision.spec;
    console.log("--- spec ---");
    console.log(`goal: ${spec.goal}`);
    printList("requirements", spec.requirements);
    printList("constraints", spec.constraints);
    printList("non_goals", spec.nonGoals);
    printList("acceptance", spec.acceptance);
    printList("verification", spec.verification);
    if (spec.ambiguities.length) {
      console.log("ambiguity_details:");
      for (const item of spec.ambiguities) {
        console.log(
          `- [${item.classification}/${item.status}] ${item.question}`,
        );
        if (item.resolution) {
          console.log(`  resolution: ${item.resolution}`);
        }
        if (item.basis) {
          console.log(`  basis: ${item.basis}`);
        }
      }
    }
    console.log("--- end spec ---");
  }
  if (result.unresolvedQuestions.length) {
    console.log("unresolved_questions:");
    for (const question of result.unresolvedQuestions) {
      console.log(`- ${question.question}`);
      console.log(`  classification: ${question.classification}`);
      if (question.basis) {
        console.log(`  basis: ${question.basis}`);
      }
    }
  }
  console.log(
    `turns/model_calls: ${result.turns}/${result.modelCalls} (spec ${result.specTurns}/${result.specModelCalls})`,
  );
  console.log(`tool_calls: ${result.toolCalls} (spec ${result.specToolCalls})`);
  if (result.implementationStarted) {
    console.log(
      `final_tests: ${result.finalVerificationPassed ? "PASS" : "FAIL"} (exit ${result.finalVerification?.exitCode ?? "n/a"})`,
    );
    console.log(
      `received_terminal_response: ${result.receivedTerminalResponse}`,
    );
  } else {
    console.log("final_tests: (skipped — implementation not started)");
  }
  console.log(
    `changed_files: ${result.changedFiles.length ? result.changedFiles.join(", ") : "(none)"}`,
  );
  if (result.unifiedDiff.trim()) {
    console.log("--- diff ---");
    console.log(result.unifiedDiff);
    console.log("--- end diff ---");
  }
  console.log(`trace: ${result.tracePath}`);
  console.log(`spec: ${result.specPath}`);
  console.log(`duration_ms: ${result.durationMs}`);
  console.log(`model_final_response:\n${result.modelFinalResponse}`);
}

function formatEscalationMessage(
  decision: Extract<SpecDecision, { status: "needs_human_judgment" }>,
): string {
  const questions = decision.unresolvedQuestions
    .map((item) => `- ${item.question}`)
    .join("\n");
  return [
    "Escalated: needs_human_judgment. Implementation loop was not started.",
    questions || "- (unresolved product question not listed in ambiguities)",
  ].join("\n");
}

function baseResult(fields: {
  task: string;
  workflowStatus: WorkflowStatus;
  failureReason?: HarnessRunResult["failureReason"];
  specDecision: SpecDecision | null;
  unresolvedQuestions: Ambiguity[];
  implementationStarted: boolean;
  implementation: AgentRunResult | null;
  specPhase: {
    turns: number;
    modelCalls: number;
    toolCalls: number;
  };
  receivedTerminalResponse: boolean;
  finalVerificationPassed: boolean;
  finalVerification: VerificationResult | null;
  modelFinalResponse: string;
  changedFiles: string[];
  unifiedDiff: string;
  tracePath: string;
  durationMs: number;
}): HarnessRunResult {
  const implementation = fields.implementation;
  return {
    task: fields.task,
    workflowStatus: fields.workflowStatus,
    failureReason: fields.failureReason,
    specDecision: fields.specDecision,
    unresolvedQuestions: fields.unresolvedQuestions,
    implementationStarted: fields.implementationStarted,
    implementation,
    specTurns: fields.specPhase.turns,
    specModelCalls: fields.specPhase.modelCalls,
    specToolCalls: fields.specPhase.toolCalls,
    turns: fields.specPhase.turns + (implementation?.turns ?? 0),
    modelCalls: fields.specPhase.modelCalls + (implementation?.modelCalls ?? 0),
    toolCalls: fields.specPhase.toolCalls + (implementation?.toolCalls ?? 0),
    receivedTerminalResponse: fields.receivedTerminalResponse,
    finalVerificationPassed: fields.finalVerificationPassed,
    finalVerification: fields.finalVerification,
    modelFinalResponse: fields.modelFinalResponse,
    changedFiles: fields.changedFiles,
    unifiedDiff: fields.unifiedDiff,
    tracePath: fields.tracePath,
    specPath: "",
    durationMs: fields.durationMs,
  };
}

async function finishRun(
  tracer: Tracer,
  result: HarnessRunResult,
): Promise<void> {
  result.specPath = writeSpecArtifact(tracer.tracePath, {
    task: result.task,
    decision: result.specDecision?.status ?? null,
    spec: result.specDecision?.spec ?? null,
    unresolvedQuestions: result.unresolvedQuestions,
    implementationStarted: result.implementationStarted,
    workflowStatus: result.workflowStatus,
  });
  tracer.record("run_completed", {
    version: "v1",
    workflowStatus: result.workflowStatus,
    specDecision: result.specDecision?.status ?? null,
    spec: result.specDecision?.spec ?? null,
    specPath: result.specPath,
    implementationStarted: result.implementationStarted,
    failureReason: result.failureReason ?? null,
    unresolvedQuestions: result.unresolvedQuestions,
    turns: result.turns,
    modelCalls: result.modelCalls,
    toolCalls: result.toolCalls,
    specModelCalls: result.specModelCalls,
    specToolCalls: result.specToolCalls,
    receivedTerminalResponse: result.receivedTerminalResponse,
    finalVerificationPassed: result.finalVerificationPassed,
    changedFiles: result.changedFiles,
    durationMs: result.durationMs,
  });
  await tracer.close();
}

function printList(label: string, items: string[]): void {
  if (!items.length) {
    console.log(`${label}: (none)`);
    return;
  }
  console.log(`${label}:`);
  for (const item of items) {
    console.log(`- ${item}`);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}
