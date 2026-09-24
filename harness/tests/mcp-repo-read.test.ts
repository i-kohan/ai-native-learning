import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { HarnessConfig } from "../src/config.ts";
import {
  runAgentLoop,
  type ResponsesCreateFn,
  type ResponsesCreateRequest,
} from "../src/loop.ts";
import {
  admitDiscoveredTools,
  openRepoReadSession,
  REPO_READ_TOOL_NAME,
  type DiscoveredMcpTool,
} from "../src/mcp/repo-read-host.ts";

function workspace(): { root: string; secret: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-repo-read-"));
  const secret = "mcp01-secret-file-contents";
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "ok.ts"), `${secret}\n`, "utf8");
  return { root, secret };
}

describe("repo_read_file MCP host", () => {
  it("discovers and reads through a real stdio client/server boundary", async () => {
    const { root, secret } = workspace();
    const session = await openRepoReadSession({ allowedRoot: root });
    try {
      assert.equal(session.protocolRevision(), "2026-07-28");
      assert.equal(session.protocolEra(), "modern");
      assert.ok(
        session.discovered.some((tool) => tool.name === REPO_READ_TOOL_NAME),
      );
      assert.deepEqual(
        session.tools.map((tool) => tool.name),
        [REPO_READ_TOOL_NAME],
      );

      const result = await session.call(
        REPO_READ_TOOL_NAME,
        JSON.stringify({ path: "src/ok.ts" }),
      );
      assert.equal(result.ok, true);
      assert.match(result.output, new RegExp(secret));

      const tool = session.tools[0];
      assert.equal(tool?.type, "function");
      const parameters = tool?.parameters ?? {};
      const properties = parameters.properties as Record<string, { type?: string }>;
      assert.equal(properties.path?.type, "string");
      assert.ok((parameters.required as string[]).includes("path"));
      for (const key of ["root", "allowedRoot", "credential", "apiKey", "token"]) {
        assert.equal(Object.hasOwn(properties, key), false);
      }
    } finally {
      await session.close();
    }
  });

  it("fails closed for traversal, absolute, and missing paths", async () => {
    const { root, secret } = workspace();
    const session = await openRepoReadSession({ allowedRoot: root });
    try {
      for (const relativePath of [
        "../../../../etc/passwd",
        "/etc/passwd",
        "src/missing.ts",
      ]) {
        const result = await session.call(
          REPO_READ_TOOL_NAME,
          JSON.stringify({ path: relativePath }),
        );
        assert.equal(result.ok, false, relativePath);
        assert.equal(result.output.includes(secret), false);
      }
    } finally {
      await session.close();
    }
  });

  it("does not expose a discovered tool excluded by the host allowlist", async () => {
    const { root, secret } = workspace();
    const session = await openRepoReadSession({
      allowedRoot: root,
      allowlist: [],
    });
    try {
      assert.ok(
        session.discovered.some((tool) => tool.name === REPO_READ_TOOL_NAME),
      );
      assert.deepEqual(session.tools, []);
      assert.equal(
        session.rejected.some(
          (item) =>
            item.name === REPO_READ_TOOL_NAME &&
            item.reason === "not_in_host_allowlist",
        ),
        true,
      );
      const result = await session.call(
        REPO_READ_TOOL_NAME,
        JSON.stringify({ path: "src/ok.ts" }),
      );
      assert.equal(result.ok, false);
      assert.match(result.output, /Host admission denied/);
      assert.equal(result.output.includes(secret), false);
    } finally {
      await session.close();
    }
  });

  it("rejects a matching tool name whose schema exposes root configuration", () => {
    const discovered: DiscoveredMcpTool[] = [
      {
        name: REPO_READ_TOOL_NAME,
        description: "bad",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            allowedRoot: { type: "string" },
          },
          required: ["path", "allowedRoot"],
          additionalProperties: false,
        },
      },
    ];
    const admission = admitDiscoveredTools(discovered, [REPO_READ_TOOL_NAME]);
    assert.deepEqual(admission.admitted, []);
    assert.match(admission.rejected[0]?.reason ?? "", /schema_exposes_allowedRoot/);
  });

  it("does not pass OPENAI_API_KEY to the MCP child", async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-mcp01-sentinel";
    const { root, secret } = workspace();
    try {
      const session = await openRepoReadSession({ allowedRoot: root });
      try {
        const result = await session.call(
          REPO_READ_TOOL_NAME,
          JSON.stringify({ path: "src/ok.ts" }),
        );
        assert.equal(result.ok, true);
        assert.match(result.output, new RegExp(secret));
        assert.equal(session.serverStderr().includes("OPENAI_API_KEY"), false);
      } finally {
        await session.close();
      }
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});

describe("implementation worker MCP routing", () => {
  it("replaces direct read_file with admitted repo_read_file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-worker-"));
    const targetAppRoot = path.join(root, "target-app");
    const targetSrcRoot = path.join(targetAppRoot, "src");
    fs.mkdirSync(targetSrcRoot, { recursive: true });
    fs.writeFileSync(path.join(targetSrcRoot, "app.ts"), "export const marker = 1;\n");
    const config: HarnessConfig = {
      apiKey: "test",
      model: "test-model",
      maxTurns: 4,
      maxRepairAttempts: 1,
      maxReviewRepairAttempts: 1,
      repoRoot: root,
      targetAppRoot,
      targetSrcRoot,
      tracesDir: path.join(root, "traces"),
    };
    const requests: ResponsesCreateRequest[] = [];
    const create: ResponsesCreateFn = async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        return {
          id: "resp_a",
          output: [
            {
              type: "function_call",
              call_id: "c1",
              name: "repo_read_file",
              arguments: JSON.stringify({ path: "src/app.ts" }),
            },
          ],
        } as never;
      }
      return {
        id: "resp_b",
        output: [
          { type: "message", content: [{ type: "output_text", text: "done" }] },
        ],
        output_text: "done",
      } as never;
    };

    const result = await runAgentLoop({
      config,
      task: "read the file",
      runId: "mcp-worker",
      responsesCreate: create,
      mcpRepoReadEnabled: true,
    });

    const names = (requests[0]?.tools as Array<{ name: string }>).map(
      (tool) => tool.name,
    );
    assert.equal(names.includes("read_file"), false);
    assert.ok(names.includes("repo_read_file"));
    assert.ok(names.includes("write_file"));
    assert.ok(names.includes("list_files"));
    assert.ok(names.includes("run_command"));
    assert.equal(result.status, "success");
    const trace = fs.readFileSync(result.tracePath, "utf8");
    assert.match(trace, /repo_read_file/);
    assert.match(trace, /export const marker = 1/);
  });
});
