import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { PathAccessError, resolveWithin } from "../paths.ts";

const MCP_ALLOWED_ROOT_ENV = "MCP_ALLOWED_ROOT";

export function startRepoReadServer(): void {
  if (process.env.OPENAI_API_KEY) {
    console.error(
      "refusing to start: OPENAI_API_KEY is present in the MCP server environment",
    );
    process.exit(1);
  }

  const allowedRoot = process.env[MCP_ALLOWED_ROOT_ENV];
  if (!allowedRoot || !path.isAbsolute(allowedRoot)) {
    console.error(
      `${MCP_ALLOWED_ROOT_ENV} must be an absolute path supplied by the host.`,
    );
    process.exit(1);
  }

  serveStdio(() => createRepoReadServer(allowedRoot), { legacy: "reject" });
}

function createRepoReadServer(allowedRoot: string): McpServer {
  const server = new McpServer({
    name: "harness-repo-read",
    version: "0.1.0",
  });

  server.registerTool(
    "repo_read_file",
    {
      description:
        "Read a UTF-8 text file inside the host-configured workspace. Path is relative. The model cannot choose the allowed root.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Relative path inside the allowed workspace root."),
      }),
    },
    async ({ path: relativePath }) => readRepoFile(allowedRoot, relativePath),
  );

  return server;
}

function readRepoFile(
  allowedRoot: string,
  relativePath: string,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  try {
    const target = resolveWithin(allowedRoot, relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return toolError(`File does not exist: ${relativePath}`);
    }
    return {
      content: [{ type: "text", text: fs.readFileSync(target, "utf8") }],
    };
  } catch (error) {
    const message =
      error instanceof PathAccessError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return toolError(message);
  }
}

function toolError(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

if (process.argv[1]?.endsWith("repo-server.ts")) {
  startRepoReadServer();
}
