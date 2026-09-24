# 23 — MCP as a capability boundary

## Goal

Understand what MCP standardizes in an agent system, what authority it does **not** provide, and when an MCP boundary is better than wiring an SDK/API directly into the harness.

Protocol baseline for this module: **2026-07-28**. Re-verify the current MCP revision before future protocol work.

## 1. Why MCP exists

Without a shared protocol, every AI host tends to build provider-specific adapters:

```text
Host A → custom GitHub adapter
Host B → another GitHub adapter
Host C → another GitHub adapter
```

Each adapter may need its own discovery, schemas, invocation conventions, transport, error handling, and auth integration.

MCP introduces a common boundary:

```text
Host
→ MCP Client
→ protocol
→ MCP Server
→ capability / data / external service
```

A useful bounded analogy is LSP:

```text
LSP → editor ↔ language tooling
MCP → AI host ↔ capability/context provider
```

MCP standardizes the integration boundary. It does not standardize the whole agent workflow.

## 2. Core roles

### Host

The AI application / orchestrator.

In this project:

```text
our harness ≈ Host
```

The Host owns:

- model interaction;
- which servers are connected/trusted;
- Host policy and tool admission;
- what is exposed to the model;
- workflow orchestration.

### MCP Client

The protocol participant acting on behalf of the Host.

It handles MCP communication with a server.

```text
MCP Client ≠ end user
```

### MCP Server

Exposes capabilities or data through MCP.

Examples:

- repository/filesystem service;
- GitHub integration;
- database service;
- documentation/knowledge system;
- internal company API.

A server may be a local process owned by us or a remote service owned by someone else. Location/ownership does not define the architectural role.

## 3. MCP is not an agent framework

MCP does **not** define our lifecycle:

```text
Spec
→ Worker
→ VERIFY
→ REVIEW
→ repair / retry
→ workflow state
```

It does not decide:

- when a Worker should run;
- whether a tool should be allowed;
- whether the task succeeded;
- retry/repair budgets;
- reviewer authority;
- durable checkpoints;
- model routing.

For our architecture:

```text
MCP     = HOW the Host reaches a capability
Host    = WHETHER that capability may be used
Harness = WHAT happens next and WHAT counts as success
```

Authority remains outward.

## 4. Current protocol / transport mental model

The 2026-07-28 protocol core is stateless: application state may persist, but a request should not depend on hidden protocol-session state from earlier requests.

```text
application state ≠ protocol state
connection lifetime ≠ protocol state
```

A long-lived stdio pipe is compatible with a stateless protocol.

### stdio

Typical local integration:

```text
Host
→ spawn MCP Server process
→ stdin/stdout carry MCP messages
```

Useful when the capability provider runs locally and its lifecycle should follow the Host.

Important:

```text
stdio ≠ in-process function call
stdio ≠ sandbox
```

The child process still has the OS permissions it is given.

### Streamable HTTP

Typical remote/network integration:

```text
MCP Client
→ POST /mcp
→ JSON response or request-scoped stream
```

Stateless HTTP fits ordinary load balancing, restarts, horizontal scaling, and web infrastructure.

Heuristic:

```text
stdio → launch a capability provider beside this Host
HTTP  → connect to an already-running capability service
```

This is a deployment heuristic, not a protocol rule.

## 5. Server primitives

### Tools

Callable operations with machine-described input/output contracts.

Examples:

```text
search_code(query)
repo_read_file(path)
create_issue(...)
query_database(...)
```

A Tool may be read-only or side-effecting.

Tool availability does not imply permission.

### Resources

Addressable information/context.

Examples:

```text
repo://architecture
docs://service/api
database://schema/users
```

A Resource is semantically "read this addressable context/data", not merely "a Tool that happens to return a string", even though both may transport similar bytes.

### Prompts

Reusable server-provided prompt/workflow templates.

The Host retrieves the prompt and decides how to use it with its own model.

```text
MCP Prompt ≠ system-prompt authority
```

A server-provided prompt is external input and cannot override Host policy.

Useful shorthand:

```text
Tool     = operation / capability
Resource = addressable context/data
Prompt   = reusable model-interaction template
```

## 6. Discovery, schemas, and admission

A key MCP benefit is dynamic discovery.

Conceptually:

```text
connect
→ discover server/capabilities
→ list tools/resources/prompts
→ inspect metadata/schema
→ Host admission
→ expose selected capabilities
→ invoke
```

The critical separation is:

```text
discovered
≠ trusted
≠ schema-valid
≠ authorized
≠ exposed to model
```

Discovery is information. Admission is Host policy.

### JSON Schema

Tool schemas provide a portable machine-readable contract:

- name/description;
- input shape;
- validation;
- dynamic model-facing tool construction;
- interoperability between Hosts and Servers.

But:

```text
schema-valid ≠ semantically safe
```

For example, this may be perfectly schema-valid:

```text
delete_repository({ repo: "production" })
```

and still be forbidden.

For MCP01 the Host admits only the narrow contract it expects:

```text
repo_read_file
inputSchema.type === object
path.type === string
path required
additionalProperties === false
no model-controlled root/credential fields
```

A matching tool name alone is insufficient.

## 7. Authority and security layers

Keep these layers separate:

```text
discovered
→ server says the capability exists

schema-valid
→ the request has the expected shape

physically capable
→ server/credentials/OS can perform it

authorized
→ Host policy permits this agent/episode to perform it
```

```text
CAN ≠ MAY
```

A useful narrowing model:

```text
external account permissions
→ credential/token scope
→ server-exposed capabilities
→ Host-admitted capabilities
→ episode-specific exposure
```

Each layer should normally narrow authority.

### Credentials

Prefer:

```text
Host/server infrastructure → owns credentials
model                     → receives capability, not credential
```

Do not put secrets into tool arguments merely so the model can pass them back.

### Server content is untrusted input

Tool descriptions, Resource contents, Prompt contents, errors, and tool results may contain prompt injection.

Treat them as:

```text
DATA
not harness authority
```

### MCP is not a sandbox

A local MCP process may still access filesystem/network/subprocesses allowed by the OS account.

```text
MCP protocol boundary ≠ OS sandbox
```

MCP01 therefore keeps an explicit `allowedRoot` and reuses `resolveWithin()`.

## 8. Authentication / authorization

For remote HTTP integrations, keep three questions separate:

```text
authentication → who is this?
authorization  → what may this principal do?
MCP protocol   → how are capabilities/context exchanged?
```

OAuth-style authorization may grant a remote MCP client access to a service, but that does not replace Host policy.

Example:

```text
token permits repo:write
Host exposes only repo_read_file
→ Worker still cannot write
```

External authorization defines an upper bound. The Host may narrow it further.

Local stdio often has a different deployment/trust model and may not need remote OAuth, but it still needs capability scoping and OS/security reasoning.

## 9. Multi Round-Trip Requests and client-side features

**MRTR = Multi Round-Trip Requests.**

If a server cannot finish one logical operation because it needs additional input, it can return an `input_required` result. The client fulfills that input and re-issues the original operation.

Conceptually:

```text
tools/call
→ input_required
→ Host obtains/provides input
→ repeat original call with input
→ final result
```

This preserves a stateless request model instead of relying on arbitrary server callbacks.

Current 2026-07-28 guidance:

- elicitation/input-required remains relevant;
- standalone sampling and roots are deprecated for new designs;
- new integrations should not build around deprecated sampling/roots unless compatibility requires it.

MCP01 does not need MRTR or these richer client-side features.

## 10. Direct SDK/API vs MCP

MCP is useful when the capability genuinely crosses an integration boundary.

### Direct integration is usually better when

- one harness owns the capability;
- the tool surface is static;
- the implementation is tightly coupled to local internals;
- portability/discovery provides little value;
- minimal latency/complexity matters.

Example:

```text
resolveWithin()
WorkflowState.saveCheckpoint()
local verifier → npm test
```

Turning these into MCP would mostly add process/protocol overhead.

### MCP becomes attractive when

- multiple Hosts should reuse one integration;
- a separate team/provider owns the capability;
- dynamic discovery matters;
- the capability is an external/service boundary;
- standard Tools/Resources/Prompts reduce custom adapters.

Example:

```text
Cursor ──────┐
our harness ─┼→ company GitHub MCP Server → GitHub
CI agent ────┘
```

The main value is not "the model can use GitHub" — a direct SDK wrapper can already provide that.

The value is:

```text
standardized integration boundary
+ discovery
+ portable machine-readable contract
+ reuse across Hosts
```

Decision heuristic:

```text
Is this primarily an internal implementation detail?
→ prefer direct function/SDK

Is this a reusable capability/provider boundary?
→ MCP is a strong candidate
```

MCP should normally live at the **edges** of the agent system, not at the center of orchestration.

## 11. MCP01 mapping to our harness

Current direct path:

```text
Worker function_call
→ harness
→ executeTool()
→ read_file()
```

MCP01 path:

```text
Implementation Worker
→ Host admission
→ MCP Client
→ stdio
→ local MCP Server
→ repo_read_file(path)
```

What changed:

- discovery;
- schema ownership;
- invocation/transport;
- provider boundary.

What did **not** change:

- Spec authority;
- workspace ownership;
- Host admission;
- writes;
- VERIFY;
- REVIEW;
- repair/retry policy;
- workflow success.

The model chooses a relative path. The Host chooses the allowed root.

## 12. Module conclusions

1. MCP is a capability/context integration protocol, not an orchestration architecture.
2. Discovery does not grant authority.
3. Schema validation proves shape, not safety or permission.
4. Credentials and configuration should remain infrastructure-owned.
5. stdio gives a real protocol/process boundary but no sandbox.
6. MCP has real value at reusable/provider boundaries; direct SDK/function calls remain preferable for many internal capabilities.
7. MCP01 proves mechanism compatibility, not quality improvement.
8. The current harness should keep direct repository reads as the default; one local tightly-coupled read does not justify MCP overhead.
9. Keep the MCP path as evidence and as a pattern for future reusable/external integrations.
