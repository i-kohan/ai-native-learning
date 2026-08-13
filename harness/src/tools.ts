import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { HarnessConfig } from "./config.ts";
import { PathAccessError, resolveWithin, toRepoRelative } from "./paths.ts";
import { childEnvWithoutTestContext } from "./verify.ts";

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    name: "list_files",
    description: "List files and directories under target-app/. Path is relative to target-app/.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path inside target-app/. Use '.' for the root.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "read_file",
    description: "Read a UTF-8 text file under target-app/. Path is relative to target-app/.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path inside target-app/.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "write_file",
    description:
      "Write a UTF-8 text file under target-app/src/ only. Path is relative to target-app/src/.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path inside target-app/src/.",
        },
        content: {
          type: "string",
          description: "Full file contents to write.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "run_command",
    description:
      "Run an allowed verification command with cwd fixed to target-app/. Currently only 'npm test' is allowed.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Allowed command. Use exactly: npm test",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export type ToolExecution = {
  ok: boolean;
  output: string;
};

export function executeTool(
  config: HarnessConfig,
  name: string,
  argsJson: string,
): ToolExecution {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    switch (name) {
      case "list_files":
        return listFiles(config, String(args.path ?? "."));
      case "read_file":
        return readFile(config, String(args.path ?? ""));
      case "write_file":
        return writeFile(config, String(args.path ?? ""), String(args.content ?? ""));
      case "run_command":
        return runCommand(config, String(args.command ?? ""));
      default:
        return { ok: false, output: `Unknown tool: ${name}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message };
  }
}

function listFiles(config: HarnessConfig, relativePath: string): ToolExecution {
  const target = resolveWithin(config.targetAppRoot, relativePath === "" ? "." : relativePath);
  if (!fs.existsSync(target)) {
    return { ok: false, output: `Path does not exist: ${relativePath}` };
  }

  const entries = fs.readdirSync(target, { withFileTypes: true });
  const lines = entries
    .map((entry) => {
      const rel = toRepoRelative(config.repoRoot, path.join(target, entry.name));
      return entry.isDirectory() ? `${rel}/` : rel;
    })
    .sort();

  return { ok: true, output: lines.join("\n") || "(empty)" };
}

function readFile(config: HarnessConfig, relativePath: string): ToolExecution {
  const target = resolveWithin(config.targetAppRoot, relativePath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return { ok: false, output: `File does not exist: ${relativePath}` };
  }
  const content = fs.readFileSync(target, "utf8");
  return { ok: true, output: content };
}

function writeFile(config: HarnessConfig, relativePath: string, content: string): ToolExecution {
  const target = resolveWithin(config.targetSrcRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return {
    ok: true,
    output: `Wrote ${toRepoRelative(config.repoRoot, target)} (${content.length} bytes)`,
  };
}

function runCommand(config: HarnessConfig, command: string): ToolExecution {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized !== "npm test") {
    return {
      ok: false,
      output: `Command not allowed: ${command}. Only 'npm test' is permitted.`,
    };
  }

  const result = spawnSync("npm", ["test"], {
    cwd: config.targetAppRoot,
    encoding: "utf8",
    env: childEnvWithoutTestContext(),
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = [
    `exit_code=${result.status ?? 1}`,
    stdout.trim(),
    stderr.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    ok: result.status === 0,
    output,
  };
}

export function formatToolError(error: unknown): string {
  if (error instanceof PathAccessError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
