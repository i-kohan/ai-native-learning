# 25 — A2A as an agent boundary

## Mental model

A2A is a protocol for one agent runtime to delegate work to another agent runtime.

```text
MCP ≈ host ↔ capability / context
A2A ≈ client agent ↔ remote agent
```

The remote agent owns its episode: it can inspect, decide, and produce an artifact. The Host still owns permission, workflow state, and what the artifact means.

```text
Worker intent
→ Host discovers Agent Card
→ Host admits the agent
→ SendMessage
→ remote Task
→ Artifact
→ Host validates the artifact
→ advisory evidence
→ outer VERIFY / REVIEW
```

Discovery is not permission. A completed Task is not parent success.

## What v1 standardizes

Protocol baseline for this module: **A2A 1.0**, SDK `@a2a-js/sdk@1.0.1`. Re-verify the current revision before later protocol work.

The Agent Card is published at `/.well-known/agent-card.json`. `supportedInterfaces` names a binding (`HTTP+JSON`, `JSONRPC`, or `GRPC`) and a `protocolVersion` such as `1.0`. Patch numbers are not part of compatibility.

`SendMessage` carries a `Message` made of `Part`s. A `Part` is one of text, raw bytes, url, or structured `data`. Task outputs belong in `Artifact`s, not in a reply `Message`.

A `Task` has its own `id`, an optional `contextId` for related interactions, and a `TaskState`. `TASK_STATE_COMPLETED` is terminal for that task. It is not a workflow phase.

`contextId` groups related A2A interactions. It is not `WorkflowState` and not memory.

## Authority split

```text
remote agent owns the attempt
Host owns admission and consequence
```

The Worker may name an objective and a scope. It does not choose the endpoint, root, credential, protocol, or policy.

The remote process receives an allowlisted environment plus `A2A_ALLOWED_ROOT` and `A2A_REMOTE_OPENAI_API_KEY`. It does not inherit `OPENAI_API_KEY`.

The Host admits the card only when the expected name, skill `repository-impact-analysis`, HTTP+JSON binding, protocol `1.0`, and endpoint all match. Otherwise it does not call `SendMessage`.

After a completed Task, the Host checks the artifact schema and that every path stays inside the delegated root. `../../secret.txt` is rejected. Accepted text is one compact tool observation. It does not mark implementation successful.

## Boundaries

This probe is one local process and one skill. It is not a directory, a swarm, a gateway, or a replacement for MCP, direct tools, or the Module 13 subagent.

Streaming, push notifications, and blind `SendMessage` retries are out of scope. A timeout after send is uncertain: the remote task may already exist.

## Observations from this module

- The official client discovers the card with `DefaultAgentCardResolver` / `ClientFactory` and sends with `RestTransportFactory`. The server side is `DefaultRequestHandler`, `AgentExecutor`, and `restHandler`.
- Blocking `SendMessage` (`returnImmediately: false`) returned a completed `Task` with the artifact in the local tests, so `getTask` polling stayed unused on that path.
- Card admission and artifact admission are separate fail-closed checks. A completed Task with a path outside scope was rejected and was not formatted as Worker evidence.
- The parent workflow id is not reused as `taskId`. The SDK assigns the remote task id. On the T01 evidence run those ids, plus `delegationId` and `contextId`, were four different values. A completed Task still left VERIFY and REVIEW in charge.

## Takeaways

- A2A delegates an episode to another agent. It does not delegate authority.
- Fetch the Agent Card. Then admit it. Then send.
- Require a `Task` and an `Artifact` when the result is data, not only a `Message`.
- Validate remote paths and schema in the Host. Treat card, task, and artifact as untrusted input.
- Keep the seam off by default until a real cross-runtime episode needs it.
