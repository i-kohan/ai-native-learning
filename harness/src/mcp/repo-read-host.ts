import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export const MCP_PROTOCOL_REVISION = "2026-07-28";
export const REPO_READ_TOOL_NAME = "repo_read_file";
export const MCP_ALLOWED_ROOT_ENV = "MCP_ALLOWED_ROOT";
export const DEFAULT_REPO_READ_ALLOWLIST = [REPO_READ_TOOL_NAME] as const;

const FORBIDDEN_ARGUMENT_KEYS = [
  "root",
  "allowedRoot",
  "allowed_root",
  "mcpAllowedRoot",
  "MCP_ALLOWED_ROOT",
  "credential",
  "credentials",
  "apiKey",
  "api_key",
  "token",
  "secret",
];

export type DiscoveredMcpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type ResponsesFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
};

export type ToolAdmission = {
  admitted: ResponsesFunctionTool[];
  rejected: Array<{ name: string; reason: string }>;
};

export type McpToolResult = {
  ok: boolean;
  output: string;
};

export async function openRepoReadSession(options: {
  allowedRoot: string;
  allowlist?: readonly string[];
}): Promise<RepoReadSession> {
  if (!path.isAbsolute(options.allowedRoot)) {
    throw new Error("MCP allowed root must be an absolute host path.");
  }

  const harnessDir = fileURLToPath(new URL("../..", import.meta.url));
  const serverPath = fileURLToPath(
    new URL("./repo-server.ts", import.meta.url),
  );
  const allowlist = options.allowlist ?? DEFAULT_REPO_READ_ALLOWLIST;
  let stderr = "";
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", serverPath],
    cwd: harnessDir,
    stderr: "pipe",
    env: {
      [MCP_ALLOWED_ROOT_ENV]: options.allowedRoot,
    },
  });
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const client = new Client(
    { name: "harness-repo-read-host", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: MCP_PROTOCOL_REVISION } } },
  );

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const discovered = listed.tools.map(toDiscoveredTool);
    const admission = admitDiscoveredTools(discovered, allowlist);
    return new RepoReadSession(client, discovered, admission, () => stderr);
  } catch (error) {
    await client.close().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const detail = stderr.trim();
    throw new Error(
      detail ? `${message}\nMCP server stderr:\n${detail}` : message,
    );
  }
}

export class RepoReadSession {
  constructor(
    private readonly client: Client,
    readonly discovered: DiscoveredMcpTool[],
    private readonly admission: ToolAdmission,
    private readonly stderr: () => string,
  ) {}

  get tools(): ResponsesFunctionTool[] {
    return this.admission.admitted;
  }

  get rejected(): ToolAdmission["rejected"] {
    return this.admission.rejected;
  }

  protocolRevision(): string | undefined {
    return this.client.getNegotiatedProtocolVersion();
  }

  protocolEra(): string | undefined {
    return this.client.getProtocolEra();
  }

  async call(name: string, argsJson: string): Promise<McpToolResult> {
    if (!this.tools.some((tool) => tool.name === name)) {
      return {
        ok: false,
        output: `Host admission denied tool: ${name}`,
      };
    }

    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(argsJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, output: "MCP tool arguments must be an object." };
      }
      args = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, output: "MCP tool arguments must be valid JSON." };
    }

    const result = await this.client.callTool({ name, arguments: args });
    const output = textContent(result.content);
    return {
      ok: result.isError !== true,
      output,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  serverStderr(): string {
    return this.stderr();
  }
}

export function admitDiscoveredTools(
  discovered: DiscoveredMcpTool[],
  allowlist: readonly string[],
): ToolAdmission {
  const admitted: ResponsesFunctionTool[] = [];
  const rejected: ToolAdmission["rejected"] = [];
  const allowed = new Set(allowlist);

  for (const tool of discovered) {
    if (!allowed.has(tool.name)) {
      rejected.push({ name: tool.name, reason: "not_in_host_allowlist" });
      continue;
    }
    if (tool.name !== REPO_READ_TOOL_NAME) {
      rejected.push({ name: tool.name, reason: "unsupported_capability" });
      continue;
    }
    const schemaError = repoReadSchemaError(tool.inputSchema);
    if (schemaError) {
      rejected.push({ name: tool.name, reason: schemaError });
      continue;
    }
    admitted.push(toResponsesTool(tool));
  }

  return { admitted, rejected };
}

function toDiscoveredTool(tool: {
  name: string;
  description?: string;
  inputSchema: { [key: string]: unknown };
}): DiscoveredMcpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

function toResponsesTool(tool: DiscoveredMcpTool): ResponsesFunctionTool {
  return {
    type: "function",
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.inputSchema,
    strict: tool.inputSchema.additionalProperties === false,
  };
}

function repoReadSchemaError(schema: Record<string, unknown>): string | null {
  if (schema.type !== "object") {
    return "schema_not_object";
  }
  const properties = schema.properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  ) {
    return "schema_missing_properties";
  }
  const props = properties as Record<string, unknown>;
  const forbidden = Object.keys(props).filter((key) =>
    FORBIDDEN_ARGUMENT_KEYS.includes(key),
  );
  if (forbidden.length > 0) {
    return `schema_exposes_${forbidden.join("_")}`;
  }
  if (schema.additionalProperties === true) {
    return "schema_allows_arbitrary_arguments";
  }
  const pathSchema = props.path;
  if (
    !pathSchema ||
    typeof pathSchema !== "object" ||
    Array.isArray(pathSchema)
  ) {
    return "schema_missing_path";
  }
  const pathType = (pathSchema as { type?: unknown }).type;
  const pathIsString =
    pathType === "string" ||
    (Array.isArray(pathType) && pathType.includes("string"));
  if (!pathIsString) {
    return "schema_path_not_string";
  }
  const required = schema.required;
  if (!Array.isArray(required) || !required.includes("path")) {
    return "schema_path_not_required";
  }
  return null;
}

function textContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
