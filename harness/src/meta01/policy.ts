export const META01_EXPERIMENT_ID = "META01" as const;

export const META01_PARENT_REVISION =
  "afc1abdc0f8f528a3d45b2c1495fea35e74c6aa7";

export const META01_IMPROVER_MAX_TURNS = 12;
export const META01_MAINTENANCE_MAX_TURNS = 16;
export const META01_CANDIDATE_COUNT = 1;
export const META01_TRIALS_PER_ARM = 3;
export const META01_MAX_PATCH_LINES = 300;
export const META01_MAX_FILES = 3;
export const META01_MAX_NEW_FILES = 2;

/** Only existing file the candidate may overwrite. */
export const CANDIDATE_EXISTING_FILE = "harness/src/loop.ts";

/** Create-only area. Names inside it are chosen by the candidate. */
export const CANDIDATE_CREATE_DIR = "harness/src/loop-ext";

export const META01_READ_FILES = [
  "harness/src/loop.ts",
  "harness/src/instructions.ts",
  "harness/src/review-instructions.ts",
  "harness/src/evidence.ts",
  "harness/src/research-instructions.ts",
  "harness/src/research-subagent.ts",
  "harness/src/a2a/delegation.ts",
  "harness/src/a2a/constants.ts",
  "harness/src/mcp/repo-read-host.ts",
  "harness/src/tools.ts",
  "harness/src/skills.ts",
  "harness/src/context.ts",
  "harness/src/trace.ts",
  "harness/src/diff.ts",
  "harness/src/config.ts",
  "harness/src/model-routing.ts",
] as const;

export const CORE_LOOP_FUNCTIONS = [
  "runAgentLoop",
  "episodeInstructions",
  "executeWorkerTool",
] as const;

export type CoreLoopFunction = (typeof CORE_LOOP_FUNCTIONS)[number];

export const META01_REGRESSION_TASKS = [
  "tsc",
  "npm-test",
  "ISO01",
  "SEC01",
  "T01",
  "T02",
  "T03",
  "T04",
  "R01",
  "REV01",
] as const;

export type Meta01RegressionTask = (typeof META01_REGRESSION_TASKS)[number];

export const FORBIDDEN_AUTHORITY_PATTERNS: Array<{ id: string; pattern: RegExp }> =
  [
    { id: "child_process", pattern: /\bchild_process\b/ },
    { id: "spawn", pattern: /\bspawn(Sync)?\s*\(/ },
    { id: "exec", pattern: /\bexec(Sync|File|FileSync)?\s*\(/ },
    { id: "node:net", pattern: /\bnode:net\b/ },
    { id: "node:http", pattern: /\bnode:https?\b/ },
    { id: "node:dgram", pattern: /\bnode:dgram\b/ },
    { id: "fetch", pattern: /\bfetch\s*\(/ },
    { id: "createServer", pattern: /\bcreateServer\s*\(/ },
    { id: "WebSocket", pattern: /\bWebSocket\b/ },
    { id: "maxTurns_assign", pattern: /\bmaxTurns\s*=\s*\d+/ },
    { id: "maxRepairAttempts_assign", pattern: /\bmaxRepairAttempts\s*=\s*\d+/ },
    { id: "retry_import", pattern: /from\s+["'][^"']*retry/ },
  ];

export type Meta01Decision =
  | "candidate_rejected"
  | "candidate_promising_but_inconclusive"
  | "candidate_accepted_for_this_workload"
  | "experiment_stopped_insufficient_regression_evidence";
