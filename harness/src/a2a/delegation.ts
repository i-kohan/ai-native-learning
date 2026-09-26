import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessConfig } from "../config.ts";
import {
  A2A_ALLOWED_ROOT_ENV,
  A2A_BASE_URL_ENV,
  A2A_PORT_ENV,
  A2A_REMOTE_MODEL_ENV,
  A2A_REMOTE_OPENAI_API_KEY_ENV,
} from "./constants.ts";
import {
  performRemoteImpactDelegation,
  type A2aDelegationOutcome,
  type A2aDelegationRecord,
} from "./host.ts";

export type { A2aDelegationRecord };

export const DELEGATE_REMOTE_ANALYSIS_TOOL = {
  type: "function" as const,
  name: "delegate_remote_analysis",
  description:
    "Ask the admitted remote impact agent about one bounded repository scope. Pass only objective and scope. The result is advisory evidence, not Spec, VERIFY, REVIEW, or workflow success.",
  parameters: {
    type: "object",
    properties: {
      objective: {
        type: "string",
        description: "The bounded impact question.",
      },
      scope: {
        type: "string",
        description:
          "Relative directory inside target-app to inspect, such as src.",
      },
    },
    required: ["objective", "scope"],
    additionalProperties: false,
  },
  strict: true,
};

export const WORKER_A2A_INSTRUCTIONS = `
You must call delegate_remote_analysis exactly once before the first write_file.
Pass only objective and scope. Scope is a relative directory inside target-app, such as src.
You cannot choose the remote endpoint, filesystem root, credentials, protocol version, or security policy.
The result is advisory evidence only. It is not Spec, permission, verification, review, or workflow success.
You still implement the Spec. The harness still runs VERIFY and independent REVIEW.
`.trim();

const ENV_ALLOWLIST = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG"];

export function parseDelegateRemoteAnalysis(
  argsJson: string,
):
  | { ok: true; value: { objective: string; scope: string } }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return {
      ok: false,
      error: "delegate_remote_analysis arguments must be valid JSON.",
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: "delegate_remote_analysis payload must be an object.",
    };
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "objective" && key !== "scope") {
      return {
        ok: false,
        error: `delegate_remote_analysis cannot set ${key}.`,
      };
    }
  }
  if (typeof parsed.objective !== "string" || parsed.objective.trim() === "") {
    return {
      ok: false,
      error: "delegate_remote_analysis.objective must be a non-empty string.",
    };
  }
  if (typeof parsed.scope !== "string" || parsed.scope.trim() === "") {
    return {
      ok: false,
      error: "delegate_remote_analysis.scope must be a non-empty string.",
    };
  }
  return {
    ok: true,
    value: { objective: parsed.objective.trim(), scope: parsed.scope.trim() },
  };
}

export async function delegateRemoteAnalysis(options: {
  config: HarnessConfig;
  workflowId: string;
  objective: string;
  scope: string;
}): Promise<{ ok: boolean; output: string; record: A2aDelegationRecord }> {
  const remoteApiKey = process.env[A2A_REMOTE_OPENAI_API_KEY_ENV]?.trim() ?? "";
  if (!remoteApiKey) {
    return {
      ok: false,
      output:
        "Remote impact delegation is not configured. The host did not send the parent API key.",
      record: localFailure(
        options.workflowId,
        "remote_failed",
        "remote_credential_missing",
      ),
    };
  }

  const agent = await startImpactAgentProcess({
    allowedRoot: options.config.targetAppRoot,
    remoteApiKey,
    model: options.config.model,
  });
  try {
    const result = await performRemoteImpactDelegation({
      workflowId: options.workflowId,
      baseUrl: agent.baseUrl,
      allowedRoot: options.config.targetAppRoot,
      objective: options.objective,
      scope: options.scope,
      remotePid: agent.pid,
    });
    return { ok: result.ok, output: result.output, record: result.record };
  } finally {
    await agent.stop();
  }
}

export async function startImpactAgentProcess(options: {
  allowedRoot: string;
  remoteApiKey: string;
  model: string;
}): Promise<{ baseUrl: string; pid: number; stop: () => Promise<void> }> {
  if (!path.isAbsolute(options.allowedRoot)) {
    throw new Error("A2A allowed root must be an absolute host path.");
  }
  const port = await reserveLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverPath = fileURLToPath(
    new URL("./impact-server.ts", import.meta.url),
  );
  const harnessDir = fileURLToPath(new URL("../..", import.meta.url));
  let stderr = "";
  const child = spawn(process.execPath, ["--import", "tsx", serverPath], {
    cwd: harnessDir,
    env: remoteProcessEnv({
      allowedRoot: options.allowedRoot,
      remoteApiKey: options.remoteApiKey,
      model: options.model,
      port,
      baseUrl,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });
  try {
    await waitForCard(baseUrl, child, () => stderr);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return {
    baseUrl,
    pid: child.pid ?? -1,
    stop: () => stopChild(child),
  };
}

export function remoteProcessEnv(options: {
  allowedRoot: string;
  remoteApiKey: string;
  model: string;
  port: number;
  baseUrl: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  env[A2A_ALLOWED_ROOT_ENV] = options.allowedRoot;
  env[A2A_REMOTE_OPENAI_API_KEY_ENV] = options.remoteApiKey;
  env[A2A_REMOTE_MODEL_ENV] = options.model;
  env[A2A_PORT_ENV] = String(options.port);
  env[A2A_BASE_URL_ENV] = options.baseUrl;
  return env;
}

function localFailure(
  workflowId: string,
  outcome: A2aDelegationOutcome,
  reason: string,
): A2aDelegationRecord {
  return {
    workflowId,
    delegationId: randomUUID(),
    taskId: null,
    contextId: null,
    remotePid: null,
    cardDiscovered: false,
    agentName: null,
    protocolVersion: null,
    binding: null,
    admission: "fail",
    admissionReason: reason,
    sendMessagePerformed: false,
    taskTerminalState: null,
    artifactAdmission: "absent",
    grantsWorkflowSuccess: false,
    outcome,
  };
}

async function waitForCard(
  baseUrl: string,
  child: ChildProcess,
  stderr: () => string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError = "agent card was not served";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Remote impact agent exited ${child.exitCode}. ${stderr().trim()}`.trim(),
      );
    }
    try {
      const response = await fetch(`${baseUrl}/.well-known/agent-card.json`);
      if (response.ok) {
        return;
      }
      lastError = `agent card status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(lastError);
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function reserveLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local port."));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
