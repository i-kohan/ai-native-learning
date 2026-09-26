import { randomUUID } from "node:crypto";
import {
  Role,
  TaskState,
  type GetTaskRequest,
  type Message,
  type SendMessageRequest,
  type SendMessageResult,
  type Task,
} from "@a2a-js/sdk";
import {
  ClientFactory,
  DefaultAgentCardResolver,
  RestTransportFactory,
} from "@a2a-js/sdk/client";
import { admitDiscoveredAgent } from "./admission.ts";
import {
  admitImpactArtifact,
  formatImpactEvidence,
  type ImpactAnalysisArtifact,
} from "./artifact.ts";
import { impactInterfaceUrl } from "./constants.ts";

const POLL_LIMIT = 3;

export type A2aDelegationOutcome =
  | "accepted"
  | "discovery_failed"
  | "admission_rejected"
  | "client_failed"
  | "not_a_task"
  | "task_not_completed"
  | "artifact_rejected"
  | "remote_failed"
  | "transport_uncertain";

export type A2aDelegationRecord = {
  workflowId: string;
  delegationId: string;
  taskId: string | null;
  contextId: string | null;
  remotePid: number | null;
  cardDiscovered: boolean;
  agentName: string | null;
  protocolVersion: string | null;
  binding: string | null;
  admission: "pass" | "fail";
  admissionReason: string | null;
  sendMessagePerformed: boolean;
  taskTerminalState: string | null;
  artifactAdmission: "accepted" | "rejected" | "absent";
  grantsWorkflowSuccess: false;
  outcome: A2aDelegationOutcome;
};

export type ImpactCaller = {
  sendMessage(request: SendMessageRequest): Promise<SendMessageResult>;
  getTask(request: GetTaskRequest): Promise<Task>;
};

export async function performRemoteImpactDelegation(options: {
  workflowId: string;
  baseUrl: string;
  allowedRoot: string;
  objective: string;
  scope: string;
  remotePid?: number | null;
  discoverCard?: (baseUrl: string) => Promise<unknown>;
  openClient?: (card: unknown) => Promise<ImpactCaller>;
}): Promise<{
  ok: boolean;
  output: string;
  record: A2aDelegationRecord;
  artifact: ImpactAnalysisArtifact | null;
}> {
  const delegationId = randomUUID();
  const remotePid = options.remotePid ?? null;
  const base = emptyRecord(options.workflowId, delegationId, remotePid);

  let card: unknown;
  try {
    card = await (options.discoverCard ?? discoverAgentCard)(options.baseUrl);
  } catch (error) {
    return rejected(base, {
      outcome: "discovery_failed",
      admissionReason: errorMessage(error),
      output: "Remote agent card discovery failed. Delegation was not sent.",
    });
  }

  const admission = admitDiscoveredAgent(card, {
    interfaceUrl: impactInterfaceUrl(options.baseUrl),
  });
  if (!admission.ok) {
    return rejected(
      {
        ...base,
        cardDiscovered: true,
      },
      {
        outcome: "admission_rejected",
        admissionReason: admission.reason,
        output: `Remote agent was not admitted (${admission.reason}). Delegation was not sent.`,
      },
    );
  }

  let caller: ImpactCaller;
  try {
    caller = await (options.openClient ?? openAdmittedClient)(card);
  } catch (error) {
    return rejected(
      {
        ...base,
        cardDiscovered: true,
        agentName: admission.agent.name,
        protocolVersion: admission.agent.protocolVersion,
        binding: admission.agent.binding,
        admission: "pass",
      },
      {
        outcome: "client_failed",
        admissionReason: errorMessage(error),
        output:
          "Admitted remote agent client could not be opened. Delegation was not sent.",
      },
    );
  }

  const request = buildImpactSendRequest({
    objective: options.objective,
    scope: options.scope,
  });
  let result: SendMessageResult;
  try {
    result = await caller.sendMessage(request);
  } catch (error) {
    return {
      ok: false,
      output:
        "Remote send did not finish. The host will not retry SendMessage, because the remote task may already have started.",
      artifact: null,
      record: {
        ...base,
        cardDiscovered: true,
        agentName: admission.agent.name,
        protocolVersion: admission.agent.protocolVersion,
        binding: admission.agent.binding,
        admission: "pass",
        sendMessagePerformed: true,
        outcome: "transport_uncertain",
        admissionReason: errorMessage(error),
      },
    };
  }

  if (!isTaskResult(result)) {
    return {
      ok: false,
      output:
        "Remote agent returned a Message instead of a Task. No advisory evidence was accepted.",
      artifact: null,
      record: {
        ...admittedRecord(base, admission.agent),
        sendMessagePerformed: true,
        outcome: "not_a_task",
      },
    };
  }

  let task = result;
  if (!isTerminal(taskStateLabel(task.status?.state))) {
    task = await pollTask(caller, task);
  }
  const state = taskStateLabel(task.status?.state);
  const identified = {
    ...admittedRecord(base, admission.agent),
    sendMessagePerformed: true,
    taskId: task.id,
    contextId: task.contextId || null,
    taskTerminalState: state,
  };

  if (
    state === "TASK_STATE_FAILED" ||
    state === "TASK_STATE_CANCELED" ||
    state === "TASK_STATE_REJECTED"
  ) {
    return {
      ok: false,
      output: "Remote task ended without advisory evidence.",
      artifact: null,
      record: { ...identified, outcome: "remote_failed" },
    };
  }
  if (state !== "TASK_STATE_COMPLETED") {
    return {
      ok: false,
      output:
        "Remote task did not complete. No advisory evidence was accepted.",
      artifact: null,
      record: { ...identified, outcome: "task_not_completed" },
    };
  }

  const payload = artifactPayload(task);
  const artifactAdmission = admitImpactArtifact(payload, {
    allowedRoot: options.allowedRoot,
    scope: options.scope,
  });
  if (!artifactAdmission.ok) {
    return {
      ok: false,
      output: `Remote artifact was rejected (${artifactAdmission.reason}). It was not given to the Worker as evidence.`,
      artifact: null,
      record: {
        ...identified,
        artifactAdmission: "rejected",
        admissionReason: artifactAdmission.reason,
        outcome: "artifact_rejected",
      },
    };
  }

  return {
    ok: true,
    output: formatImpactEvidence(artifactAdmission.value, options.objective),
    artifact: artifactAdmission.value,
    record: {
      ...identified,
      artifactAdmission: "accepted",
      outcome: "accepted",
    },
  };
}

export function buildImpactSendRequest(options: {
  objective: string;
  scope: string;
}): SendMessageRequest {
  const message: Message = {
    messageId: randomUUID(),
    contextId: "",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [
      {
        content: {
          $case: "data",
          value: {
            objective: options.objective,
            scope: options.scope,
          },
        },
        metadata: undefined,
        filename: "",
        mediaType: "application/json",
      },
    ],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
  return {
    tenant: "",
    message,
    configuration: {
      acceptedOutputModes: ["application/json"],
      taskPushNotificationConfig: undefined,
      historyLength: 0,
      returnImmediately: false,
    },
    metadata: undefined,
  };
}

export function taskStateLabel(state: unknown): string {
  if (typeof state === "string" && state.startsWith("TASK_STATE_")) {
    return state;
  }
  if (typeof state === "number") {
    const name = TaskState[state];
    return typeof name === "string" ? name : "TASK_STATE_UNSPECIFIED";
  }
  return "TASK_STATE_UNSPECIFIED";
}

async function discoverAgentCard(baseUrl: string): Promise<unknown> {
  const resolver = new DefaultAgentCardResolver();
  return resolver.resolve(baseUrl);
}

async function openAdmittedClient(card: unknown): Promise<ImpactCaller> {
  const factory = new ClientFactory({
    transports: [new RestTransportFactory()],
    preferredTransports: ["HTTP+JSON"],
  });
  const client = await factory.createFromAgentCard(card as never);
  return {
    sendMessage: (request) =>
      client.sendMessage(request, { signal: AbortSignal.timeout(180_000) }),
    getTask: (request) => client.getTask(request),
  };
}

async function pollTask(caller: ImpactCaller, task: Task): Promise<Task> {
  let current = task;
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    if (isTerminal(taskStateLabel(current.status?.state))) {
      return current;
    }
    await delay(200);
    try {
      current = await caller.getTask({
        tenant: "",
        id: current.id,
        historyLength: 0,
      });
    } catch {
      return current;
    }
  }
  return current;
}

function artifactPayload(task: Task): unknown {
  const artifacts = task.artifacts ?? [];
  const named =
    artifacts.find((artifact) => artifact.name === "ImpactAnalysis") ??
    artifacts[0];
  if (!named) {
    return undefined;
  }
  for (const part of named.parts ?? []) {
    if (part.content?.$case === "data") {
      return part.content.value;
    }
  }
  return undefined;
}

function isTaskResult(value: SendMessageResult): value is Task {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "status" in value &&
    !("messageId" in value)
  );
}

function isTerminal(state: string): boolean {
  return (
    state === "TASK_STATE_COMPLETED" ||
    state === "TASK_STATE_FAILED" ||
    state === "TASK_STATE_CANCELED" ||
    state === "TASK_STATE_REJECTED" ||
    state === "TASK_STATE_INPUT_REQUIRED" ||
    state === "TASK_STATE_AUTH_REQUIRED"
  );
}

function admittedRecord(
  base: A2aDelegationRecord,
  agent: { name: string; protocolVersion: string; binding: string },
): A2aDelegationRecord {
  return {
    ...base,
    cardDiscovered: true,
    agentName: agent.name,
    protocolVersion: agent.protocolVersion,
    binding: agent.binding,
    admission: "pass",
    admissionReason: null,
  };
}

function emptyRecord(
  workflowId: string,
  delegationId: string,
  remotePid: number | null,
): A2aDelegationRecord {
  return {
    workflowId,
    delegationId,
    taskId: null,
    contextId: null,
    remotePid,
    cardDiscovered: false,
    agentName: null,
    protocolVersion: null,
    binding: null,
    admission: "fail",
    admissionReason: null,
    sendMessagePerformed: false,
    taskTerminalState: null,
    artifactAdmission: "absent",
    grantsWorkflowSuccess: false,
    outcome: "discovery_failed",
  };
}

function rejected(
  base: A2aDelegationRecord,
  details: {
    outcome: A2aDelegationOutcome;
    admissionReason: string;
    output: string;
  },
): {
  ok: boolean;
  output: string;
  record: A2aDelegationRecord;
  artifact: null;
} {
  return {
    ok: false,
    output: details.output,
    artifact: null,
    record: {
      ...base,
      admission: "fail",
      admissionReason: details.admissionReason,
      sendMessagePerformed: false,
      outcome: details.outcome,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
