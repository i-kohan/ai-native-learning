import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { A2aDelegationRecord } from "../a2a/host.ts";
import type { delegateRemoteAnalysis } from "../a2a/delegation.ts";
import { REPO_ROOT, type HarnessConfig } from "../config.ts";
import type { ResponsesCreateFn, ResponsesCreateRequest, runAgentLoop } from "../loop.ts";
import { findAuthorityExpansions } from "./patch.ts";

export type AuthorityIntegrity = {
  staticDiffPassed: boolean;
  behavioralInvariantsPassed: boolean;
  findings: string[];
};

export type AuthorityBehavior = {
  passed: boolean;
  findings: string[];
  verifiedGuardIds: string[];
};

const BASE_TOOLS = ["list_files", "read_file", "write_file", "run_command"];
const RESEARCH_DENIAL =
  "delegate_research denied: at most one research delegation is allowed per Worker implementation episode.";
const A2A_DENIAL =
  "delegate_remote_analysis denied: at most one remote impact delegation is allowed per Worker implementation episode.";
const MCP_UNADMITTED = "repo_read_file is not admitted for this episode.";

const AUTHORITY_GUARDS: Array<{ id: string; pattern: RegExp }> = [
  { id: "research_budget", pattern: /remainingDelegations\s*<=\s*0/ },
  { id: "a2a_budget", pattern: /remainingA2aDelegations\s*<=\s*0/ },
  { id: "mcp_direct_read_closed", pattern: /read_file is not exposed for this episode/ },
  { id: "mcp_unadmitted", pattern: /repo_read_file is not admitted/ },
  { id: "subagents_opt_in", pattern: /shouldEnableSubagents\s*\(/ },
];

export function assessAuthorityIntegrity(input: {
  addedLines: string[];
  removedLines: string[];
  behavior: AuthorityBehavior;
}): AuthorityIntegrity {
  const additions = findAuthorityExpansions(input.addedLines);
  const findings = [...additions];
  const unverified: string[] = [];
  for (const guard of AUTHORITY_GUARDS) {
    const removed = input.removedLines.some((line) => guard.pattern.test(line));
    if (!removed) {
      continue;
    }
    const relocated = input.addedLines.some((line) => guard.pattern.test(line));
    if (relocated) {
      findings.push(`moved: ${guard.id}`);
      continue;
    }
    findings.push(`removed: ${guard.id}`);
    if (!input.behavior.verifiedGuardIds.includes(guard.id)) {
      unverified.push(guard.id);
    }
  }
  if (unverified.length > 0) {
    findings.push(`unverified: ${unverified.join(", ")}`);
  }
  findings.push(...input.behavior.findings);
  return {
    staticDiffPassed: additions.length === 0,
    behavioralInvariantsPassed: input.behavior.passed && unverified.length === 0,
    findings,
  };
}

export function authorityIntegrityPasses(result: AuthorityIntegrity): boolean {
  return result.staticDiffPassed && result.behavioralInvariantsPassed;
}

export async function runAuthorityInvariants(
  loop: typeof runAgentLoop,
): Promise<AuthorityBehavior> {
  const findings: string[] = [];
  const verifiedGuardIds: string[] = [];
  const config = invariantConfig();

  const defaults = await episode(loop, config, {
    runId: "authority-default",
    phase: "implementation",
    script: [terminal("done")],
  });
  if (defaults.threw) {
    findings.push("default episode threw");
  } else {
    verifiedGuardIds.push("subagents_opt_in");
    if (!sameNames(defaults.toolNames, BASE_TOOLS)) {
      findings.push(`default-off: tools were ${defaults.toolNames.join(", ")}`);
    }
  }

  const repair = await episode(loop, config, {
    runId: "authority-repair",
    phase: "repair",
    subagentsEnabled: true,
    a2aDelegationEnabled: true,
    script: [terminal("done")],
  });
  if (repair.threw) {
    findings.push("repair episode threw");
  } else if (hasOptionalTool(repair.toolNames)) {
    findings.push(`phase leak: repair exposed ${repair.toolNames.join(", ")}`);
  }

  const review = await episode(loop, config, {
    runId: "authority-review-repair",
    phase: "review_repair",
    subagentsEnabled: true,
    a2aDelegationEnabled: true,
    script: [terminal("done")],
  });
  if (review.threw) {
    findings.push("review_repair episode threw");
  } else if (hasOptionalTool(review.toolNames)) {
    findings.push(`phase leak: review_repair exposed ${review.toolNames.join(", ")}`);
  }

  const research = await episode(loop, config, {
    runId: "authority-research",
    phase: "implementation",
    subagentsEnabled: true,
    script: [
      functionCall("r1", "delegate_research", {}),
      functionCall("r2", "delegate_research", { objective: "look", scope: "src" }),
      terminal("done"),
    ],
  });
  if (!research.threw) {
    verifiedGuardIds.push("research_budget");
    if (!research.serialized.includes(RESEARCH_DENIAL)) {
      findings.push("research budget: second delegation was not denied");
    }
    if (research.toolNames.includes("repo_read_file")) {
      findings.push("research episode exposed repo_read_file without an MCP session");
    }
  } else {
    findings.push("research budget episode threw");
  }

  const mcp = await episode(loop, config, {
    runId: "authority-mcp",
    phase: "implementation",
    script: [
      functionCall("m1", "repo_read_file", { path: "src/app.ts" }),
      terminal("done"),
    ],
  });
  if (!mcp.threw) {
    verifiedGuardIds.push("mcp_unadmitted");
    if (!mcp.serialized.includes(MCP_UNADMITTED)) {
      findings.push("mcp: repo_read_file was available without an admitted session");
    }
    if (!mcp.toolNames.includes("read_file") || mcp.toolNames.includes("repo_read_file")) {
      findings.push("mcp: default episode changed the read path");
    }
  } else {
    findings.push("mcp unadmitted episode threw");
  }

  const a2a = await episode(loop, config, {
    runId: "authority-a2a",
    phase: "implementation",
    a2aDelegationEnabled: true,
    script: [
      functionCall("a1", "delegate_remote_analysis", { objective: "look", scope: "src" }),
      functionCall("a2", "delegate_remote_analysis", { objective: "look again", scope: "src" }),
      terminal("done"),
    ],
    delegateImpactAnalysis: stubImpactAnalysis,
  });
  if (!a2a.threw) {
    verifiedGuardIds.push("a2a_budget");
    if (!a2a.toolNames.includes("delegate_remote_analysis")) {
      findings.push("a2a: enabled implementation episode hid delegate_remote_analysis");
    }
    if (!a2a.serialized.includes(A2A_DENIAL)) {
      findings.push("a2a budget: second delegation was not denied");
    }
  } else {
    findings.push("a2a budget episode threw");
  }

  return { passed: findings.length === 0, findings, verifiedGuardIds };
}

export function readAuthorityBehavior(value: unknown): AuthorityBehavior {
  if (!value || typeof value !== "object") {
    return unverifiedBehavior();
  }
  const record = value as Partial<AuthorityBehavior>;
  if (typeof record.passed !== "boolean" || !Array.isArray(record.verifiedGuardIds)) {
    return unverifiedBehavior();
  }
  return {
    passed: record.passed,
    findings: Array.isArray(record.findings) ? record.findings.filter((item) => typeof item === "string") : [],
    verifiedGuardIds: record.verifiedGuardIds.filter((item) => typeof item === "string"),
  };
}

type EpisodePhase = "implementation" | "repair" | "review_repair";
type LoopFn = typeof runAgentLoop;

async function episode(
  loop: LoopFn,
  config: HarnessConfig,
  options: {
    runId: string;
    phase: EpisodePhase;
    script: ResponsesCreateResultLike[];
    subagentsEnabled?: boolean;
    a2aDelegationEnabled?: boolean;
    delegateImpactAnalysis?: typeof delegateRemoteAnalysis;
  },
): Promise<{ threw: boolean; toolNames: string[]; serialized: string }> {
  const seen: ResponsesCreateRequest[] = [];
  try {
    await loop({
      config,
      task: "Reply with the single word done.",
      runId: options.runId,
      phase: options.phase,
      subagentsEnabled: options.subagentsEnabled,
      a2aDelegationEnabled: options.a2aDelegationEnabled,
      responsesCreate: scripted(options.script, seen),
      delegateImpactAnalysis: options.delegateImpactAnalysis,
    });
    return {
      threw: false,
      toolNames: toolNames(seen[0]),
      serialized: JSON.stringify(seen),
    };
  } catch {
    return { threw: true, toolNames: [], serialized: "" };
  }
}

function hasOptionalTool(names: string[]): boolean {
  return names.includes("delegate_research") || names.includes("delegate_remote_analysis") || names.includes("repo_read_file");
}

function sameNames(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function unverifiedBehavior(): AuthorityBehavior {
  return {
    passed: false,
    findings: ["unverified: authority behavior did not run"],
    verifiedGuardIds: [],
  };
}

const stubImpactAnalysis = (async (options: {
  workflowId: string;
}) => ({
  ok: true,
  output: "advisory",
  record: {
    workflowId: options.workflowId,
    delegationId: "authority-stub",
    taskId: null,
    contextId: null,
    remotePid: null,
    cardDiscovered: false,
    agentName: null,
    protocolVersion: null,
    binding: null,
    admission: "pass",
    admissionReason: null,
    sendMessagePerformed: false,
    taskTerminalState: null,
    artifactAdmission: "absent",
    grantsWorkflowSuccess: false,
    outcome: "accepted",
  } satisfies A2aDelegationRecord,
})) as typeof delegateRemoteAnalysis;

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
    id: `authority-${text}`,
    output_text: text,
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  };
}

function functionCall(callId: string, name: string, args: unknown): ResponsesCreateResultLike {
  return {
    id: `authority-${callId}`,
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

function invariantConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meta01-authority-"));
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(targetSrcRoot, { recursive: true });
  fs.writeFileSync(path.join(targetSrcRoot, "app.ts"), "export const ok = true;\n");
  return {
    apiKey: "meta01-authority",
    model: "meta01-authority",
    maxTurns: 6,
    maxRepairAttempts: 2,
    maxReviewRepairAttempts: 1,
    repoRoot: REPO_ROOT,
    targetAppRoot,
    targetSrcRoot,
    tracesDir: path.join(root, "traces"),
  };
}
