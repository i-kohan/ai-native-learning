import type { InvestigationToolDefinition } from "./investigation-episode.ts";

export const SUBMIT_SWARM_PLAN_TOOL: InvestigationToolDefinition = {
  type: "function",
  name: "submit_swarm_plan",
  description:
    "Propose worker ids, objectives, and optional scope hints. This does not choose models, tools, turn limits, write access, or rounds.",
  parameters: {
    type: "object",
    properties: {
      workers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            objective: { type: "string" },
            scopeHint: { type: "string" },
          },
          required: ["id", "objective", "scopeHint"],
          additionalProperties: false,
        },
      },
    },
    required: ["workers"],
    additionalProperties: false,
  },
  strict: true,
};

export const SUBMIT_CHILD_REPORT_TOOL: InvestigationToolDefinition = {
  type: "function",
  name: "submit_investigation_report",
  description:
    "Submit this worker's ChildInvestigationReport. Cite only files read with read_file. The harness sets the objective.",
  parameters: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim: { type: "string" },
            evidencePaths: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["claim", "evidencePaths"],
          additionalProperties: false,
        },
      },
      uncertainties: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["findings", "uncertainties"],
    additionalProperties: false,
  },
  strict: true,
};

export const SUBMIT_FINAL_REPORT_TOOL: InvestigationToolDefinition = {
  type: "function",
  name: "submit_investigation_report",
  description:
    "Submit the final InvestigationReport. durableSupport is supported, unsupported, partial, or unknown. defaultStatus is default, opt-in, or conditional.",
  parameters: {
    type: "object",
    properties: {
      mechanisms: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            entryPoints: { type: "array", items: { type: "string" } },
            activationOwner: { type: "string" },
            capabilities: { type: "array", items: { type: "string" } },
            evidence: { type: "array", items: { type: "string" } },
            retainedOuterAuthority: {
              type: "array",
              items: { type: "string" },
            },
            durableSupport: {
              type: "string",
              enum: ["supported", "unsupported", "partial", "unknown"],
            },
            defaultStatus: {
              type: "string",
              enum: ["default", "opt-in", "conditional"],
            },
            evidencePaths: { type: "array", items: { type: "string" } },
          },
          required: [
            "name",
            "entryPoints",
            "activationOwner",
            "capabilities",
            "evidence",
            "retainedOuterAuthority",
            "durableSupport",
            "defaultStatus",
            "evidencePaths",
          ],
          additionalProperties: false,
        },
      },
      uncertainties: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim: { type: "string" },
            reason: { type: "string" },
          },
          required: ["claim", "reason"],
          additionalProperties: false,
        },
      },
      coverageSummary: { type: "string" },
    },
    required: ["mechanisms", "uncertainties", "coverageSummary"],
    additionalProperties: false,
  },
  strict: true,
};
