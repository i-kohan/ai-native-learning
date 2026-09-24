# 23 — MCP as a capability boundary

## Core question

Can the harness consume one repository-read capability through a real MCP Client ↔ Server boundary without giving MCP authority over the workflow?

## 1. Mental model

```text
MCP     = how a host reaches a capability
Host    = which discovered capabilities may be used
Harness = whether work may proceed, and what counts as success
```

Discovery is not admission. A server can offer `repo_read_file`. The Host allowlist decides whether that offer is exposed to the Worker.

The allowed root is host configuration (`MCP_ALLOWED_ROOT`), not a model argument. `resolveWithin()` stays the path-containment check.

## 2. Flow

```text
Implementation Worker
→ Host admission
→ MCP Client
→ stdio
→ local MCP Server
→ repo_read_file(path)
```

Protocol pin: client `versionNegotiation` `{ pin: "2026-07-28" }`, server `serveStdio(..., { legacy: "reject" })`.

Spec, VERIFY, REVIEW, repair, writes, and workspace ownership stay on the existing harness path. MCP is opt-in (`mcpRepoReadEnabled`) and only replaces direct `read_file` for the implementation Worker.

## 3. Boundaries

- One tool. The model sends `path` only.
- No HTTP, OAuth, prompts, resources, sampling, roots, or write tools.
- The child environment is the SDK default inherited environment plus `MCP_ALLOWED_ROOT`. It does not receive the parent `process.env`, including `OPENAI_API_KEY`.
- An empty Host allowlist discovers the tool and still refuses to call it.

## 4. Failures / trade-offs

- A matching tool name is not enough. Admission also requires a string `path` and rejects model-controlled root or credential fields.
- Protocol portability costs a process and a schema. It does not improve task quality by itself.
- Repair and review still use direct `read_file`. That is intentional: MCP01 does not migrate the harness.

## 5. What we saw

1. Contract tests passed over real stdio: valid read succeeds; traversal, absolute paths, and a denied allowlist fail closed.
2. The MCP child started while the parent held `OPENAI_API_KEY` and did not see that variable.
3. One T01 DEV run: implementation called `repo_read_file` twice, `write_file` once, and never `read_file`. VERIFY PASS. Independent REVIEW `pass`.

## 6. Takeaways

- MCP moves a capability across a protocol boundary. It does not own Spec, VERIFY, REVIEW, or writes.
- Host admission is a separate step from `listTools()`.
- The model chooses the relative path. The host chooses the root.
- One successful mechanism probe is not a reason to convert the rest of the harness.
