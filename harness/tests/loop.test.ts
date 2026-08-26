import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { HarnessConfig } from "../src/config.ts";
import {
  applyModelOutput,
  applyToolOutputs,
  buildResponsesRequest,
  initialConversationInput,
  measureClientInput,
  nextPreviousResponseId,
  runAgentLoop,
  type FunctionCallOutputItem,
  type ResponsesCreateFn,
  type ResponsesCreateRequest,
  type ResponsesCreateResult,
} from "../src/loop.ts";
import { executeTool } from "../src/tools.ts";

function tempConfig(): HarnessConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-conversation-"));
  const targetAppRoot = path.join(root, "target-app");
  const targetSrcRoot = path.join(targetAppRoot, "src");
  fs.mkdirSync(targetSrcRoot, { recursive: true });
  fs.writeFileSync(
    path.join(targetSrcRoot, "app.ts"),
    "export const ok = true;\n",
  );
  fs.writeFileSync(path.join(targetAppRoot, "package.json"), "{}\n");
  return {
    apiKey: "test",
    model: "test-model",
    maxTurns: 20,
    maxRepairAttempts: 2,
    maxReviewRepairAttempts: 1,
    repoRoot: root,
    targetAppRoot,
    targetSrcRoot,
    tracesDir: path.join(root, "traces"),
  };
}

function functionCall(callId: string, name: string, args: unknown) {
  return {
    type: "function_call" as const,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
}

function scriptedCreate(
  script: ResponsesCreateResult[],
): ResponsesCreateFn & { requests: ResponsesCreateRequest[] } {
  const requests: ResponsesCreateRequest[] = [];
  const create: ResponsesCreateFn & { requests: ResponsesCreateRequest[] } =
    Object.assign(
      async (request: ResponsesCreateRequest) => {
        requests.push(request);
        const next = script[requests.length - 1];
        if (!next) {
          throw new Error(
            `unexpected extra Responses call #${requests.length}`,
          );
        }
        return next;
      },
      { requests },
    );
  return create;
}

describe("conversation-state helpers", () => {
  it("manual mode appends response.output then tool outputs (full replay)", () => {
    const start = initialConversationInput("do the task");
    const output = [functionCall("c1", "read_file", { path: "src/app.ts" })];
    const afterModel = applyModelOutput("manual", start, output);
    const tools: FunctionCallOutputItem[] = [
      { type: "function_call_output", call_id: "c1", output: "file contents" },
    ];
    const next = applyToolOutputs("manual", afterModel, tools);

    assert.equal(next.length, 3);
    assert.equal(next[0], start[0]);
    assert.equal(next[1], output[0]);
    assert.deepEqual(next[2], tools[0]);
    assert.equal(nextPreviousResponseId("manual", "resp_a"), null);
    assert.equal(
      buildResponsesRequest({
        model: "m",
        instructions: "i",
        input: next,
        tools: [],
        mode: "manual",
        previousResponseId: "resp_a",
      }).previous_response_id,
      undefined,
    );
  });

  it("previous_response_id first turn has no previous id", () => {
    const input = initialConversationInput("do the task");
    const request = buildResponsesRequest({
      model: "m",
      instructions: "i",
      input,
      tools: [],
      mode: "previous_response_id",
      previousResponseId: null,
    });
    assert.equal(request.previous_response_id, undefined);
    assert.deepEqual(request.input, input);
  });

  it("previous_response_id subsequent turn sends only new function_call_output", () => {
    const start = initialConversationInput("do the task");
    const output = [
      functionCall("c1", "read_file", { path: "src/app.ts" }),
      { type: "reasoning", id: "rs_hidden" },
    ];
    const afterModel = applyModelOutput("previous_response_id", start, output);
    assert.deepEqual(afterModel, []);

    const tools: FunctionCallOutputItem[] = [
      { type: "function_call_output", call_id: "c1", output: "file contents" },
    ];
    const next = applyToolOutputs("previous_response_id", afterModel, tools);
    assert.deepEqual(next, tools);
    assert.equal(
      next.some((item) => item.type === "function_call"),
      false,
    );
    assert.equal(
      next.some((item) => item.role === "user"),
      false,
    );

    const request = buildResponsesRequest({
      model: "m",
      instructions: "i",
      input: next,
      tools: [],
      mode: "previous_response_id",
      previousResponseId: nextPreviousResponseId(
        "previous_response_id",
        "resp_a",
      ),
    });
    assert.equal(request.previous_response_id, "resp_a");
    assert.deepEqual(request.input, tools);
  });

  it("measures client input items/bytes from the sent input only", () => {
    const input = [
      { role: "user", content: "abc" },
      { type: "function_call_output", call_id: "c1", output: "x" },
    ];
    const measured = measureClientInput(input);
    assert.equal(measured.clientInputItemCount, 2);
    assert.equal(
      measured.clientInputBytes,
      Buffer.byteLength(JSON.stringify(input), "utf8"),
    );
  });
});

describe("runAgentLoop conversation-state modes", () => {
  it("manual mode replays full history on the next Responses call", async () => {
    const config = tempConfig();
    const create = scriptedCreate([
      {
        id: "resp_a",
        output: [functionCall("c1", "read_file", { path: "src/app.ts" })],
      },
      {
        id: "resp_b",
        output: [
          { type: "message", content: [{ type: "output_text", text: "done" }] },
        ],
        output_text: "done",
      },
    ]);

    const result = await runAgentLoop({
      config,
      task: "inspect app.ts",
      runId: "manual-replay",
      responsesCreate: create,
    });

    assert.equal(result.conversationStateMode, "manual");
    assert.equal(create.requests.length, 2);
    assert.equal(create.requests[0].previous_response_id, undefined);
    assert.equal(create.requests[1].previous_response_id, undefined);

    const secondInput = create.requests[1].input as Array<
      Record<string, unknown>
    >;
    assert.equal(
      secondInput.some((item) => item.role === "user"),
      true,
    );
    assert.equal(
      secondInput.some((item) => item.type === "function_call"),
      true,
    );
    assert.equal(
      secondInput.some((item) => item.type === "function_call_output"),
      true,
    );
    assert.equal(result.receivedTerminalResponse, true);
    assert.ok(result.clientInputItemsSent > 2);
  });

  it("previous_response_id chains the immediately previous response and does not replay output", async () => {
    const config = tempConfig();
    const create = scriptedCreate([
      {
        id: "resp_a",
        output: [functionCall("c1", "read_file", { path: "src/app.ts" })],
      },
      {
        id: "resp_b",
        output: [functionCall("c2", "read_file", { path: "src/app.ts" })],
      },
      {
        id: "resp_c",
        output: [
          { type: "message", content: [{ type: "output_text", text: "done" }] },
        ],
        output_text: "done",
      },
    ]);

    const result = await runAgentLoop({
      config,
      task: "inspect app.ts",
      runId: "variant-chain",
      conversationStateMode: "previous_response_id",
      responsesCreate: create,
    });

    assert.equal(create.requests.length, 3);
    assert.equal(create.requests[0].previous_response_id, undefined);
    assert.equal(create.requests[1].previous_response_id, "resp_a");
    assert.equal(create.requests[2].previous_response_id, "resp_b");

    const firstInput = create.requests[0].input as Array<
      Record<string, unknown>
    >;
    assert.equal(firstInput.length, 1);
    assert.equal(firstInput[0].role, "user");

    const secondInput = create.requests[1].input as Array<
      Record<string, unknown>
    >;
    assert.equal(secondInput.length, 1);
    assert.equal(secondInput[0].type, "function_call_output");
    assert.equal(secondInput[0].call_id, "c1");
    assert.equal(
      secondInput.some((item) => item.type === "function_call"),
      false,
    );
    assert.equal(
      secondInput.some((item) => item.role === "user"),
      false,
    );

    const thirdInput = create.requests[2].input as Array<
      Record<string, unknown>
    >;
    assert.equal(thirdInput.length, 1);
    assert.equal(thirdInput[0].type, "function_call_output");
    assert.equal(thirdInput[0].call_id, "c2");

    assert.equal(typeof create.requests[1].instructions, "string");
    assert.equal(
      create.requests[0].instructions,
      create.requests[1].instructions,
    );
    assert.ok(Array.isArray(create.requests[1].tools));
    assert.equal(result.toolCalls, 2);
    assert.equal(result.receivedTerminalResponse, true);
  });

  it("a new runAgentLoop episode starts a new response chain", async () => {
    const config = tempConfig();
    const create = scriptedCreate([
      {
        id: "resp_impl",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "impl done" }],
          },
        ],
        output_text: "impl done",
      },
      {
        id: "resp_repair",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "repair done" }],
          },
        ],
        output_text: "repair done",
      },
    ]);

    await runAgentLoop({
      config,
      task: "implement",
      runId: "episode-impl",
      phase: "implementation",
      conversationStateMode: "previous_response_id",
      responsesCreate: create,
    });
    await runAgentLoop({
      config,
      task: "repair independently",
      runId: "episode-repair",
      phase: "implementation",
      conversationStateMode: "previous_response_id",
      responsesCreate: create,
    });

    assert.equal(create.requests.length, 2);
    assert.equal(create.requests[0].previous_response_id, undefined);
    assert.equal(create.requests[1].previous_response_id, undefined);
  });

  it("still executes custom tools locally with unchanged path restrictions", async () => {
    const config = tempConfig();
    const packageJson = path.join(config.targetAppRoot, "package.json");
    const before = fs.readFileSync(packageJson, "utf8");
    const create = scriptedCreate([
      {
        id: "resp_a",
        output: [
          functionCall("c1", "write_file", {
            path: "../package.json",
            content: "hacked",
          }),
        ],
      },
      {
        id: "resp_b",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "stopped" }],
          },
        ],
        output_text: "stopped",
      },
    ]);

    const result = await runAgentLoop({
      config,
      task: "try escape",
      runId: "tool-restriction",
      conversationStateMode: "previous_response_id",
      responsesCreate: create,
    });

    const toolOutput = create.requests[1].input as Array<
      Record<string, unknown>
    >;
    assert.equal(toolOutput[0].type, "function_call_output");
    assert.match(
      String(toolOutput[0].output),
      /traversal|escapes|not allowed/i,
    );
    assert.equal(fs.readFileSync(packageJson, "utf8"), before);
    assert.equal(result.toolCalls, 1);

    const direct = executeTool(
      config,
      "write_file",
      JSON.stringify({ path: "../package.json", content: "hacked" }),
    );
    assert.equal(direct.ok, false);
  });
});
