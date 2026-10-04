import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HarnessConfig } from "../config.ts";
import {
  type ResponsesCreateFn,
  type ResponsesCreateRequest,
  type runAgentLoop,
} from "../loop.ts";
import { withLocalInspectionSignal } from "./maintenance-adapter.ts";
import {
  LOCAL_INSPECTION_DENIAL,
  LOCAL_INSPECTION_INSTRUCTION,
  LOCAL_INSPECTION_TOOL,
  inspectedOutput,
} from "./maintenance-task.ts";

export type DefaultSnapshot = {
  toolNames: string[];
  instructions: string;
  status: string;
  readable: boolean;
  threw: boolean;
  error?: string;
};

export type CapabilityGrade = {
  passed: boolean;
  reasons: string[];
};

type LoopFn = typeof runAgentLoop;

export async function captureDefaultEpisode(loop: LoopFn): Promise<DefaultSnapshot> {
  try {
    const seen: ResponsesCreateRequest[] = [];
    const result = await withLocalInspectionSignal(false, () =>
      loop({
        config: gradeConfig(),
        task: "Reply with the single word done.",
        runId: "meta01-default",
        phase: "implementation",
        responsesCreate: scripted([terminal("done")], seen),
      }),
    );
    const readable = isReadable(result);
    return {
      toolNames: toolNames(seen[0]),
      instructions: seen[0]?.instructions ?? "",
      status: typeof result.status === "string" ? result.status : "",
      readable,
      threw: false,
    };
  } catch (error) {
    return {
      toolNames: [],
      instructions: "",
      status: "",
      readable: false,
      threw: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function pristineArchitectureFault(snapshot: DefaultSnapshot): boolean {
  return snapshot.threw || !snapshot.readable || snapshot.status !== "success";
}

export async function gradeCapability(
  snapshot: DefaultSnapshot,
  loop: LoopFn,
): Promise<CapabilityGrade> {
  const reasons: string[] = [];
  const defaults = await captureDefaultEpisode(loop);
  if (defaults.threw) {
    reasons.push("loop_threw_after_maintenance");
  } else if (!sameDefault(snapshot, defaults)) {
    reasons.push("default_path_changed");
  }

  const repair = await captureSignaledPhase(loop, "repair");
  if (repair.threw) {
    reasons.push("loop_threw_after_maintenance");
  } else if (
    repair.toolNames.includes(LOCAL_INSPECTION_TOOL) ||
    repair.instructions.includes(LOCAL_INSPECTION_INSTRUCTION)
  ) {
    reasons.push("capability_active_outside_implementation");
  }

  const enabled = await runEnabledEpisode(loop);
  reasons.push(...enabled);
  return { passed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

async function captureSignaledPhase(
  loop: LoopFn,
  phase: "repair" | "review_repair",
): Promise<DefaultSnapshot> {
  try {
    const seen: ResponsesCreateRequest[] = [];
    const result = await withLocalInspectionSignal(true, () =>
      loop({
        config: gradeConfig(),
        task: "Reply with the single word done.",
        runId: `meta01-${phase}`,
        phase,
        responsesCreate: scripted([terminal("done")], seen),
      }),
    );
    return {
      toolNames: toolNames(seen[0]),
      instructions: seen[0]?.instructions ?? "",
      status: typeof result.status === "string" ? result.status : "",
      readable: isReadable(result),
      threw: false,
    };
  } catch (error) {
    return {
      toolNames: [],
      instructions: "",
      status: "",
      readable: false,
      threw: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runEnabledEpisode(loop: LoopFn): Promise<string[]> {
  const reasons: string[] = [];
  const seen: ResponsesCreateRequest[] = [];
  try {
    const result = await withLocalInspectionSignal(true, () =>
      loop({
        config: gradeConfig(),
        task: "Inspect once.",
        runId: "meta01-enabled",
        phase: "implementation",
        responsesCreate: scripted(
          [
            functionCall("c1", LOCAL_INSPECTION_TOOL, { note: "alpha" }),
            functionCall("c2", LOCAL_INSPECTION_TOOL, { note: "beta" }),
            terminal("done"),
          ],
          seen,
        ),
      }),
    );
    const first = seen[0];
    if (!toolNames(first).includes(LOCAL_INSPECTION_TOOL)) {
      reasons.push("capability_missing");
    }
    if (!first?.instructions.includes(LOCAL_INSPECTION_INSTRUCTION)) {
      reasons.push("instruction_missing");
    }
    const serialized = JSON.stringify(seen);
    if (!serialized.includes(inspectedOutput("alpha"))) {
      reasons.push("first_success_wrong");
    }
    if (!serialized.includes(LOCAL_INSPECTION_DENIAL)) {
      reasons.push("second_call_not_denied");
    }
    const evidence = readEvidence(result);
    if (!evidence) {
      reasons.push("evidence_wrong");
    } else if (evidence.successfulUses !== 1 || evidence.deniedUses !== 1) {
      reasons.push("evidence_wrong");
    }
  } catch {
    reasons.push("loop_threw_after_maintenance");
  }
  return reasons;
}

function sameDefault(snapshot: DefaultSnapshot, current: DefaultSnapshot): boolean {
  return (
    current.readable &&
    current.status === "success" &&
    current.instructions === snapshot.instructions &&
    current.toolNames.join("\n") === snapshot.toolNames.join("\n")
  );
}

function isReadable(result: {
  status?: unknown;
  modelCalls?: unknown;
  toolCalls?: unknown;
  receivedTerminalResponse?: unknown;
}): boolean {
  return (
    typeof result.status === "string" &&
    typeof result.modelCalls === "number" &&
    typeof result.toolCalls === "number" &&
    typeof result.receivedTerminalResponse === "boolean"
  );
}

function readEvidence(result: object): { successfulUses: number; deniedUses: number } | null {
  const value = (result as { boundedLocalInspection?: unknown }).boundedLocalInspection;
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { successfulUses?: unknown; deniedUses?: unknown };
  if (typeof record.successfulUses !== "number" || typeof record.deniedUses !== "number") {
    return null;
  }
  return { successfulUses: record.successfulUses, deniedUses: record.deniedUses };
}

function toolNames(request: ResponsesCreateRequest | undefined): string[] {
  if (!request || !Array.isArray(request.tools)) {
    return [];
  }
  return request.tools
    .map((tool) => {
      if (!tool || typeof tool !== "object" || !("name" in tool)) {
        return "";
      }
      return typeof tool.name === "string" ? tool.name : "";
    })
    .filter(Boolean);
}

function scripted(
  script: ResponsesCreateResultLike[],
  seen: ResponsesCreateRequest[],
): ResponsesCreateFn {
  return async (request) => {
    seen.push(request);
    const next = script[seen.length - 1];
    if (!next) {
      throw new Error(`unexpected extra Responses call #${seen.length}`);
    }
    return next as unknown as Awaited<ReturnType<ResponsesCreateFn>>;
  };
}

type ResponsesCreateResultLike = {
  id: string;
  output_text?: string;
  output?: Array<Record<string, unknown>>;
};

function terminal(text: string): ResponsesCreateResultLike {
  return {
    id: `meta01-${text}`,
    output_text: text,
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  };
}

function functionCall(
  callId: string,
  name: string,
  args: unknown,
): ResponsesCreateResultLike {
  return {
    id: `meta01-${callId}`,
    output: [
      {
        type: "function_call",
        call_id: callId,
        name,
        arguments: JSON.stringify(args),
      },
    ],
  };
}

function gradeConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta01-grade-"));
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(targetSrcRoot, { recursive: true });
  fs.writeFileSync(path.join(targetSrcRoot, "app.ts"), "export const ok = true;\n");
  return {
    apiKey: "meta01-grade",
    model: "meta01-grade",
    maxTurns: 6,
    maxRepairAttempts: 2,
    maxReviewRepairAttempts: 1,
    repoRoot: root,
    targetAppRoot,
    targetSrcRoot,
    tracesDir: path.join(root, "traces"),
  };
}
