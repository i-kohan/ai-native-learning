/**
 * SWM01 frozen audit contract.
 *
 * Written from the repository mechanisms before any baseline or variant
 * model output. Do not retune aliases, statuses, or evidence fragments
 * to fit a run.
 *
 * Status rule:
 * - default: part of Spec → one Worker with no extra flag or binder
 * - opt-in: absent unless a caller flag or binder is set
 * - conditional: the architecture text calls the seam conditional
 *
 * Durable rule:
 * - unsupported: durable mode rejects the seam
 * - partial: some durable behavior exists, and a stated part does not
 * - supported: the mechanism's durable behavior is covered
 */

export const SWM01_CONTRACT_RULE =
  "Frozen before SWM01 baseline and variant outputs. The Lead does not grade itself.";

export const SWM01_OBJECTIVE = [
  "Audit the current harness's optional and experimental agentic mechanisms. For every relevant mechanism, determine:",
  "1. where it enters the harness;",
  "2. who decides/adopts it;",
  "3. what tools/capabilities/authority it receives;",
  "4. what artifact/evidence it returns;",
  "5. what authority remains with the outer harness;",
  "6. whether it is supported with durable execution;",
  "7. whether it is default, opt-in, or conditional.",
  "",
  "Support claims with repository paths.",
  "Explicitly preserve uncertainties and incomplete coverage.",
].join("\n");

export type Swm01DefaultStatus = "default" | "opt-in" | "conditional";

export type Swm01DurableSupport =
  | "supported"
  | "unsupported"
  | "partial"
  | "unknown";

export type Swm01FrozenSurface = {
  id: string;
  aliases: string[];
  defaultStatus: Swm01DefaultStatus;
  durableSupport: Swm01DurableSupport;
  evidencePathFragments: string[];
  activationMustMentionAny: string[];
  capabilityMustMentionAny: string[];
  retainedMustMentionAny: string[];
  note: string;
};

export const SWM01_SURFACES: readonly Swm01FrozenSurface[] = [
  {
    id: "explicit_planner",
    aliases: ["explicit planner", "planner", "planningenabled"],
    defaultStatus: "opt-in",
    durableSupport: "unsupported",
    evidencePathFragments: ["planner-phase.ts", "planner-instructions.ts"],
    activationMustMentionAny: [
      "harness",
      "caller",
      "option",
      "flag",
      "planningenabled",
    ],
    capabilityMustMentionAny: ["read", "submit_plan", "list_files", "plan"],
    retainedMustMentionAny: ["harness", "spec", "verify", "review", "workflow"],
    note: "planningEnabled is off unless the caller sets it. The planner is read-only. Durable execution rejects planningEnabled.",
  },
  {
    id: "research_subagent",
    aliases: ["research subagent", "subagent", "delegate_research"],
    defaultStatus: "opt-in",
    durableSupport: "unsupported",
    evidencePathFragments: ["research-subagent.ts", "evidence.ts"],
    activationMustMentionAny: [
      "harness",
      "caller",
      "option",
      "flag",
      "subagentsenabled",
    ],
    capabilityMustMentionAny: [
      "read",
      "evidence",
      "delegate_research",
      "submit_evidence",
    ],
    retainedMustMentionAny: ["harness", "spec", "verify", "review", "workflow"],
    note: "subagentsEnabled defaults false. The Worker may call delegate_research; the harness owns the one-call budget and the child tool list.",
  },
  {
    id: "review_plan",
    aliases: [
      "review plan",
      "reviewplan",
      "human-reviewable",
      "unitexecutionscope",
    ],
    defaultStatus: "conditional",
    durableSupport: "unsupported",
    evidencePathFragments: ["review-plan.ts"],
    activationMustMentionAny: ["harness", "caller", "binder", "option"],
    capabilityMustMentionAny: [
      "review",
      "unit",
      "scope",
      "sequential",
      "advisory",
    ],
    retainedMustMentionAny: ["harness", "spec", "verify", "review", "workflow"],
    note: "A ReviewPlan exists only when a binder is supplied. Architecture status is conditional, not the default path. Durable execution rejects it.",
  },
  {
    id: "bounded_fan_out",
    aliases: ["fan-out", "fan out", "fanout"],
    defaultStatus: "opt-in",
    durableSupport: "unsupported",
    evidencePathFragments: ["fan-out.ts", "fan-out-plan.ts"],
    activationMustMentionAny: ["harness", "caller", "binder", "option"],
    capabilityMustMentionAny: [
      "worktree",
      "fan",
      "write",
      "implement",
      "verify",
    ],
    retainedMustMentionAny: ["harness", "spec", "verify", "review", "workflow"],
    note: "FanOutPlan is binder-gated and off by default. Children can write in isolated worktrees. Durable execution rejects FanOutPlan.",
  },
  {
    id: "mcp_repo_read",
    aliases: ["mcp", "repo_read_file"],
    defaultStatus: "opt-in",
    durableSupport: "unsupported",
    evidencePathFragments: ["repo-read-host.ts", "repo-server.ts"],
    activationMustMentionAny: [
      "harness",
      "caller",
      "option",
      "flag",
      "mcpreporeadenabled",
      "host",
    ],
    capabilityMustMentionAny: ["read", "mcp", "repo_read"],
    retainedMustMentionAny: [
      "harness",
      "spec",
      "verify",
      "review",
      "workflow",
      "write",
    ],
    note: "mcpRepoReadEnabled replaces implementation read_file with Host-admitted repo_read_file. Default remains direct read_file. Durable execution rejects the flag.",
  },
  {
    id: "verified_memory",
    aliases: [
      "verified repository memory",
      "repository memory",
      "verified memory",
      "memoryrecord",
    ],
    defaultStatus: "opt-in",
    durableSupport: "unsupported",
    evidencePathFragments: ["memory.ts", "memory-store.ts"],
    activationMustMentionAny: ["harness", "caller", "option", "flag", "memory"],
    capabilityMustMentionAny: ["memory", "hint", "record", "advisory"],
    retainedMustMentionAny: ["harness", "spec", "verify", "review", "workflow"],
    note: "Memory is off unless memory.promote or memory.retrieve is set. Admission is after VERIFY PASS and REVIEW pass. Durable execution rejects memory.",
  },
  {
    id: "a2a_delegation",
    aliases: ["a2a", "agent-to-agent", "delegate_remote_analysis"],
    defaultStatus: "opt-in",
    durableSupport: "unsupported",
    evidencePathFragments: [
      "a2a/host.ts",
      "a2a/admission.ts",
      "a2a/delegation.ts",
    ],
    activationMustMentionAny: ["harness", "caller", "host", "option", "flag"],
    capabilityMustMentionAny: ["remote", "a2a", "delegate", "artifact", "read"],
    retainedMustMentionAny: ["harness", "verify", "review", "workflow", "spec"],
    note: "a2aDelegationEnabled is off by default. The Host admits one remote agent. A completed remote Task does not grant workflow success. Durable execution rejects the flag.",
  },
  {
    id: "durable_execution",
    aliases: [
      "durable execution",
      "durable workflow",
      "workflowstate",
      "workflow state",
    ],
    defaultStatus: "opt-in",
    durableSupport: "partial",
    evidencePathFragments: [
      "workflow-state.ts",
      "workflow-store.ts",
      "workflow-lease.ts",
    ],
    activationMustMentionAny: ["harness", "caller", "option", "durable"],
    capabilityMustMentionAny: [
      "checkpoint",
      "workflow",
      "lease",
      "fenc",
      "resume",
      "state",
    ],
    retainedMustMentionAny: ["harness", "workflow", "verify", "review"],
    note: "Default runV1Harness() is in-memory. Checkpoints and fencing exist. Mid-worker and mid-VERIFY crash recovery do not. Experimental seams are rejected on the durable path.",
  },
  {
    id: "github_ci_delivery",
    aliases: ["github", "ci delivery", "delivery state", "deliverystate"],
    defaultStatus: "opt-in",
    durableSupport: "partial",
    evidencePathFragments: [
      "delivery-state.ts",
      "delivery-run.ts",
      "ci-admission.ts",
    ],
    activationMustMentionAny: [
      "harness",
      "caller",
      "delivery",
      "post-terminal",
      "option",
    ],
    capabilityMustMentionAny: ["pr", "ci", "delivery", "draft", "github"],
    retainedMustMentionAny: ["harness", "workflow", "verify", "review"],
    note: "Delivery is a post-terminal DeliveryState path, not a WorkflowState phase, and runV1Harness() does not call it. GitHub is not fenced by the workflow lease.",
  },
];

/** Mentioning this probe as the default architecture is an incorrect claim. */
export const SWM01_NOT_DEFAULT_NAME = /swm01|multi-agent|swarm/i;
