# 25 — A2A as an agent boundary

## Mental model

A2A is an interoperability protocol for communicating with another **agentic system** as an independent participant.

The useful boundary is not task size or number of model calls. The useful distinction is **what the protocol exposes**:

```text
function / local tool
→ call code we own

MCP
→ expose capabilities/resources to our agent system

Subagent
→ our harness creates a bounded child reasoning episode

A2A
→ delegate a goal/task to another independently operated agent system
```

A remote A2A agent may internally use one model, many models, MCP tools, memory, planning, review, or none of those. From the A2A client side, those internals are intentionally opaque.

Therefore:

```text
complex operation behind an MCP tool ≠ automatically A2A

A2A means the autonomous agent boundary itself is explicit
in the interoperability contract.
```

Our module shorthand is:

```text
MCP ≈ vertical capability integration
A2A ≈ horizontal agent-system interoperability
```

This is a useful architectural distinction, not a claim that the protocols can never be combined.

Example:

```text
Coding Agent
  --A2A--> Remote Security Agent
                --MCP--> scanner / repo search / vulnerability DB
```

## When A2A is worth the boundary

Prefer a direct function, tool, or Module 13 Subagent when both sides are owned by the same harness/runtime/team and a simple call contract is enough.

A2A becomes more plausible when the other side is independently deployed or owned:

- another service/team/vendor;
- another framework/runtime;
- its own lifecycle and task identity;
- opaque internal reasoning/execution;
- several heterogeneous clients need the same agent contract;
- standardized discovery, task state, messages, and artifacts are useful.

Do **not** choose A2A merely because a task is large.

GitHub itself is normally an API/MCP-shaped capability provider. A hypothetical independently operated “GitHub Engineering Agent” that accepts a goal, investigates it, and owns its own task lifecycle is A2A-shaped.

## Core flow

For this harness:

```text
Worker intent
→ Host discovers Agent Card
→ Host admits the agent
→ SendMessage
→ remote Task
→ Artifact
→ Host validates the Artifact
→ advisory evidence
→ Worker continues
→ outer VERIFY / REVIEW
```

The remote agent owns its attempt. The parent Host owns admission, authority, and workflow consequence.

```text
remote Task COMPLETED
≠ parent Workflow SUCCESS
```

## Agent Card: discovery, not trust

An Agent Card describes the remote endpoint and advertised interoperability contract, including identity metadata, supported interfaces, protocol version, capabilities, skills, and security metadata.

For A2A01 the expected identity/capability is:

```text
name: harness-impact-agent
skill: repository-impact-analysis
binding: HTTP+JSON
protocol: 1.0
```

Fetching the card only answers:

> What does this endpoint claim to be and support?

It does not answer:

> Is this endpoint allowed to receive our data or influence our workflow?

That second decision belongs to Host admission.

```text
discovery
≠ authentication
≠ authorization
≠ quality
≠ trust
```

The Host admits only the expected local endpoint/origin, expected agent identity, compatible protocol, expected AgentSkill, and supported binding.

## A2A AgentSkill ≠ Module 07 Skill

The name “skill” is overloaded.

```text
Module 07 Skill
= reusable procedural knowledge loaded into our agent episode

A2A AgentSkill
= capability advertised by a remote agent in its Agent Card
```

An AgentSkill is descriptive metadata. Advertising `repository-impact-analysis` does not grant filesystem access and does not prove the remote agent performs the task well.

## Message, Part, Task, Artifact

### Message

A `Message` is one communication turn between client and remote agent.

A2A `SendMessage` may return:

- a `Message` for an immediate response; or
- a `Task` when the remote side creates stateful work.

Therefore a `SendMessage` call does not imply that a `taskId` must exist.

### Part

A `Part` is the content container used inside Messages and Artifacts. In A2A v1 it can carry text, inline raw bytes, a URL reference, or structured data.

A2A01 uses structured data.

### Task

A `Task` is a protocol-visible stateful unit of work owned by the remote system.

A2A v1 Task states include:

```text
TASK_STATE_UNSPECIFIED
TASK_STATE_SUBMITTED
TASK_STATE_WORKING
TASK_STATE_INPUT_REQUIRED
TASK_STATE_AUTH_REQUIRED
TASK_STATE_COMPLETED
TASK_STATE_FAILED
TASK_STATE_CANCELED
TASK_STATE_REJECTED
```

`COMPLETED`, `FAILED`, `CANCELED`, and `REJECTED` are terminal outcomes. `INPUT_REQUIRED` and `AUTH_REQUIRED` mean work is interrupted pending another interaction.

A completed Task should not be “reopened” as our own workflow phase. A follow-up can create another Task in the same related context.

### Artifact

An `Artifact` is a concrete deliverable produced by a Task.

For A2A01:

```text
Task
→ ImpactAnalysis Artifact
   {
     objective,
     relevantPaths[],
     findings[]
   }
```

The Artifact is still remote-controlled input. It becomes Worker evidence only after Host validation.

## Identity boundaries

Do not collapse independent identities:

```text
workflowId
= parent harness workflow identity

delegationId
= our local record of one delegation attempt

taskId
= remote A2A Task identity

contextId
= remote interaction context grouping related Messages/Tasks
```

`contextId` is not:

- a task phase;
- `WorkflowState`;
- long-term memory;
- proof of identity or authorization.

Clients should treat a server-generated `contextId` as an opaque grouping identifier.

## Task ≠ WorkflowState

This distinction is central.

```text
A2A Task
= state owned by the remote agent system for delegated work

WorkflowState
= authoritative lifecycle state owned by our harness
```

The remote may report:

```text
TASK_STATE_COMPLETED
```

while our workflow can later fail VERIFY or REVIEW.

A2A does not delegate parent workflow authority.

## Protocol model vs transport vs SDK version

For this module:

```text
A2A protocol semantics: 1.0
JavaScript SDK: @a2a-js/sdk@1.2.1
chosen binding: HTTP+JSON / REST
```

Protocol version and SDK package version are different version axes.

The official JavaScript SDK supports A2A v1 across JSON-RPC, HTTP+JSON/REST, and gRPC. A2A is therefore not “just JSON-RPC”; the Task/Message/Artifact semantics are the important interoperability model.

A2A01 deliberately uses only one binding.

## Async interaction

A2A supports several interaction patterns:

```text
request/response + task polling
streaming
push notification
```

A2A01 uses the smallest credible path. With blocking `SendMessage` in the current local probe, the SDK returned the completed Task directly, so `getTask` polling was not needed in the evidence run.

Streaming and push are not required to understand the agent boundary and remain out of scope.

## Retry and ambiguous outcomes

Crossing a process/network boundary reintroduces distributed-systems semantics.

Example:

```text
SendMessage
→ remote receives request and starts task-42
→ response is lost
→ client observes timeout
```

The timeout does **not** prove that no remote task exists.

Blindly calling `SendMessage` again may create duplicate work.

Therefore A2A01 does not implement generic retry. A send failure after dispatch is recorded as an uncertain transport outcome. Production reconciliation/idempotency policy belongs to a larger durability design, not this module.

## Authority and security boundary

The Worker controls only bounded intent:

```text
objective
scope
```

The Host/infrastructure controls:

```text
remote endpoint
allowed filesystem root
credentials
protocol/binding admission
whether delegation is allowed
what remote output may influence
```

The remote process receives an allowlisted environment plus its explicit A2A root and remote model credential. It does not inherit the parent `OPENAI_API_KEY` or arbitrary parent environment.

Remote tools are read-only:

```text
list_files
read_file
submit_impact_analysis
```

No source write, arbitrary shell, parent `WorkflowState`, VERIFY, or REVIEW authority is granted.

Invalid delegated scope fails closed before `SendMessage`; it must never widen to the whole allowed root.

After Task completion the Host independently validates the Artifact schema and every returned path against the delegated scope. A path such as `../../secret.txt` is rejected.

The sequence is:

```text
remote output
→ schema/path admission
→ accepted advisory evidence
→ Worker reasoning
```

Never:

```text
remote output
→ parent workflow success
```

## A2A vs custom RPC

A custom REST endpoint can implement the same business operation. The point of A2A is not HTTP itself.

A2A standardizes reusable agent-facing concepts such as:

- Agent Card discovery;
- advertised AgentSkills;
- Message/Part exchange;
- stateful Task lifecycle;
- Artifact delivery;
- related interaction context;
- common async/streaming/push patterns;
- protocol/security metadata.

If both systems are private, tightly coupled, and only one call shape is needed, custom RPC may still be simpler.

## A2A01 experiment

The implemented frontier is intentionally small:

```text
one Host
→ one local independent Remote Agent process
→ one advertised AgentSkill
→ one real SendMessage
→ one real Task
→ one structured Artifact
→ Host admission
→ Worker advisory evidence
→ existing VERIFY / REVIEW
```

A2A01 demonstrates the mechanism, not adoption ROI.

It does **not** prove:

- A2A improves implementation quality;
- A2A is faster or cheaper than a Subagent;
- the remote analysis is universally trustworthy;
- A2A should become the default.

Default delegation remains off.

## Common failure modes

- treating a discovered Agent Card as authorization;
- treating an advertised AgentSkill as proof of quality;
- treating remote `COMPLETED` as parent success;
- accepting Artifact contents without local validation;
- reusing `workflowId` as remote `taskId`;
- treating `contextId` as memory or workflow state;
- blind retry after an ambiguous send timeout;
- giving the remote parent credentials or broad filesystem authority;
- using A2A for a same-process function that needs no interoperability boundary;
- building registries, swarms, routing, OAuth, or multi-hop delegation before one boundary has demonstrated value.

## Observations from A2A01

- Official SDK client path: `DefaultAgentCardResolver` → Host admission → `ClientFactory` / `RestTransportFactory`.
- Server path: `DefaultRequestHandler` + `AgentExecutor` + `restHandler`.
- Separate process boundary was real; client did not directly import the server Agent Card.
- Invalid scope, missing skill, incompatible protocol, and out-of-scope Artifact paths fail closed.
- The fresh probe stored the successful delegation record in `implementation.a2aDelegations`.
- Remote `taskId`, parent `workflowId`, local `delegationId`, and `contextId` remained distinct.
- Fresh T01 probe: remote Task completed, Artifact was admitted, then normal VERIFY passed and independent REVIEW passed.

## Adoption rule

For the current harness:

```text
same harness/runtime/trust/team
+ tight latency
+ simple call semantics
→ prefer direct function / tool / Subagent

independent service/team/vendor/runtime
+ opaque autonomous execution
+ separate lifecycle
+ standardized discovery/task/artifact semantics are useful
→ A2A becomes plausible
```

A2A should remain conditional until a real cross-runtime workload demonstrates that this interoperability boundary is worth its coordination cost.

## Primary references

- A2A Protocol v1: https://a2a-protocol.org/latest/
- Core concepts: https://a2a-protocol.org/latest/topics/key-concepts/
- Protocol definitions: https://a2a-protocol.org/latest/definitions/
- Official JavaScript SDK: https://github.com/a2aproject/a2a-js
