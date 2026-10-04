import type { HarnessConfig } from "../config.ts";
import { functionTool, runToolLoop, type ToolLoopResult } from "./model-turn.ts";
import { META01_IMPROVER_MAX_TURNS, META01_READ_FILES } from "./policy.ts";
import {
  readCandidateFile,
  submitHypothesis,
  writeCandidateFile,
  type CandidateSession,
} from "./session.ts";

export function buildImproverPrompt(): string {
  return [
    "You are a bounded Meta-Improver for one harness refactor.",
    "The implementation Worker loop has accumulated feature-specific coupling for optional capabilities: subagent delegation, MCP repository read, A2A delegation, memory hints, instruction composition, tool composition, and episode-local budgets.",
    "Propose one structural refactor that reduces that coupling in the core loop while preserving current semantics and authority.",
    "",
    "Hard rules:",
    `- You have ${META01_IMPROVER_MAX_TURNS} model turns.`,
    "- Submit exactly one improvement hypothesis before any write. A write before that is rejected. A second hypothesis is rejected.",
    "- You may overwrite only harness/src/loop.ts.",
    "- You may create at most two new TypeScript files under harness/src/loop-ext/. You may not overwrite any other existing file.",
    "- The whole patch must stay within 3 files and 300 added plus deleted lines.",
    "- Do not add filesystem, network, or subprocess authority.",
    "- Do not change tests, benchmarks, eval, security, retry, model choice, or budgets.",
    "- Do not widen your own allowlist.",
    "",
    "Hypothesis fields: observedProblem, suspectedCause, proposedMutation, expectedBenefit, expectedRisks.",
    `Readable files: ${META01_READ_FILES.join(", ")} plus files you create under harness/src/loop-ext/.`,
    "run_candidate_harness_tests runs the existing harness test command. You cannot choose a shell command.",
    "A hypothesis does not admit the patch. The host evaluates it later.",
  ].join("\n");
}

export async function runMetaImprover(options: {
  config: HarnessConfig;
  session: CandidateSession;
  runTests: () => Promise<string>;
}): Promise<ToolLoopResult> {
  return runToolLoop({
    apiKey: options.config.apiKey,
    model: options.config.model,
    instructions: buildImproverPrompt(),
    task: "Inspect the current loop, submit one hypothesis, then apply one bounded refactor.",
    maxTurns: META01_IMPROVER_MAX_TURNS,
    tools: [
      functionTool(
        "read_candidate_file",
        "Read one allowlisted file from the candidate workspace.",
        { path: { type: "string" } },
        ["path"],
      ),
      functionTool(
        "submit_improvement_hypothesis",
        "Submit the single improvement hypothesis. Required before any write.",
        {
          observedProblem: { type: "string" },
          suspectedCause: { type: "string" },
          proposedMutation: { type: "string" },
          expectedBenefit: { type: "string" },
          expectedRisks: { type: "array", items: { type: "string" } },
        },
        [
          "observedProblem",
          "suspectedCause",
          "proposedMutation",
          "expectedBenefit",
          "expectedRisks",
        ],
      ),
      functionTool(
        "write_candidate_file",
        "Replace one allowlisted file in the isolated candidate workspace.",
        {
          path: { type: "string" },
          content: { type: "string" },
        },
        ["path", "content"],
      ),
      functionTool(
        "run_candidate_harness_tests",
        "Run the fixed harness test command in the candidate workspace.",
        {},
        [],
      ),
    ],
    execute: async (name, args) => {
      if (name === "read_candidate_file") {
        return readCandidateFile(options.session, stringArg(args.path)).message;
      }
      if (name === "submit_improvement_hypothesis") {
        return submitHypothesis(options.session, args).message;
      }
      if (name === "write_candidate_file") {
        return writeCandidateFile(
          options.session,
          stringArg(args.path),
          typeof args.content === "string" ? args.content : "",
        ).message;
      }
      if (name === "run_candidate_harness_tests") {
        return options.runTests();
      }
      return `unknown tool: ${name}`;
    },
  });
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}
