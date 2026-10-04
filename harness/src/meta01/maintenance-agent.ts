import fs from "node:fs";
import path from "node:path";
import type { HarnessConfig } from "../config.ts";
import { functionTool, runToolLoop, type ToolLoopResult } from "./model-turn.ts";
import { maintenanceTaskText } from "./maintenance-task.ts";
import { META01_MAINTENANCE_MAX_TURNS } from "./policy.ts";
import { maintenanceReadPath, maintenanceWritePath } from "./paths.ts";

export async function runMaintenanceAgent(options: {
  config: HarnessConfig;
  workspaceRoot: string;
}): Promise<ToolLoopResult> {
  return runToolLoop({
    apiKey: options.config.apiKey,
    model: options.config.model,
    instructions: maintenanceTaskText(),
    task: "Implement the capability contract in this isolated workspace.",
    maxTurns: META01_MAINTENANCE_MAX_TURNS,
    tools: [
      functionTool(
        "read_maintenance_file",
        "Read one harness implementation TypeScript file inside this workspace.",
        { path: { type: "string" } },
        ["path"],
      ),
      functionTool(
        "write_maintenance_file",
        "Replace one allowlisted harness implementation TypeScript file inside this workspace.",
        {
          path: { type: "string" },
          content: { type: "string" },
        },
        ["path", "content"],
      ),
    ],
    execute: async (name, args) => {
      const relativePath = typeof args.path === "string" ? args.path : "";
      if (name === "read_maintenance_file") {
        return readMaintenance(options.workspaceRoot, relativePath);
      }
      if (name === "write_maintenance_file") {
        return writeMaintenance(
          options.workspaceRoot,
          relativePath,
          typeof args.content === "string" ? args.content : "",
        );
      }
      return `unknown tool: ${name}`;
    },
  });
}

export function readMaintenance(workspaceRoot: string, relativePath: string): string {
  const located = maintenanceReadPath(workspaceRoot, relativePath);
  if (!located.ok) {
    return located.error;
  }
  if (!fs.existsSync(located.absolute)) {
    return `read denied: ${located.relative} does not exist`;
  }
  return fs.readFileSync(located.absolute, "utf8");
}

export function writeMaintenance(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): string {
  const located = maintenanceWritePath(workspaceRoot, relativePath);
  if (!located.ok) {
    return located.error;
  }
  if (content.length > 200_000) {
    return "write denied: content exceeds the file size cap";
  }
  fs.mkdirSync(path.dirname(located.absolute), { recursive: true });
  fs.writeFileSync(located.absolute, content);
  return `wrote ${located.relative}`;
}
