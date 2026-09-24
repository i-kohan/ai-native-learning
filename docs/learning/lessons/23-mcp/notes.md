# 23 — MCP01 notes

Status: **✅ COMPLETED — closed by Topic Chat on 2026-09-24.** MCP01 **PASS**. Default repository reads remain direct.

## Purpose

MCP01 is a bounded mechanism probe:

```text
Can the existing harness consume one repository-read capability
through a real MCP Client ↔ Server boundary
without transferring workflow authority to MCP?
```

It is not a whole-harness MCP migration and not a quality benchmark.

## Architecture

```text
Implementation Worker
→ Host allowlist + schema admission
→ MCP Client (pin 2026-07-28)
→ stdio
→ harness/src/mcp/repo-server.ts
→ resolveWithin(MCP_ALLOWED_ROOT, path)
→ repo_read_file
```

Default harness behavior is unchanged. `mcpRepoReadEnabled` is experiment-only and applies only to the single implementation Worker.

Direct paths remain:

```text
list_files
write_file
run_command
repair / review-repair read_file
VERIFY
REVIEW
workflow state
```

## Learning-critical files

- `harness/src/mcp/repo-server.ts` — one MCP tool; trusted root comes from server configuration.
- `harness/src/mcp/repo-read-host.ts` — stdio spawn, discovery, schema admission, model-facing tool mapping, `callTool()`, cleanup.
- `harness/src/loop.ts` — opt-in Worker routing; removes direct `read_file` and routes `repo_read_file` through the admitted MCP session.
- `harness/src/context.ts` — counts `repo_read_file` as repository navigation for discovery metrics.
- `harness/src/mcp01-probe.ts` — one bounded T01 DEV mechanism run.
- `harness/tests/mcp-repo-read.test.ts` — deterministic protocol/security/admission contracts.

Packages live in `harness/package.json`:

```text
@modelcontextprotocol/client
@modelcontextprotocol/server
zod
```

### Package-resolution note

`harness/.npmrc` intentionally contains:

```text
legacy-peer-deps=true
```

Reason: the current `openai` package declares optional peer `zod@^3.23.8`, while the MCP v2 stack uses Zod 4. Without the localized npm setting, `npm install` in `harness/` does not resolve cleanly. Keep this workaround scoped to the harness package unless the dependency conflict disappears after future package upgrades.

## Host admission

Discovery and admission are separate.

```text
server advertises repo_read_file
→ Host discovers it
→ Host allowlist checks name
→ Host validates expected schema
→ only then expose to Worker
```

The admitted schema is deliberately narrow:

```text
inputSchema.type === "object"
properties.path.type === "string"
required includes "path"
additionalProperties === false
no root / allowedRoot / credential / token / secret arguments
```

A matching name alone is not enough.

An empty Host allowlist still discovers `repo_read_file` but refuses to expose or execute it.

## Authority / security boundaries

The model controls only:

```text
path
```

The Host controls:

```text
allowedRoot
tool admission
MCP process configuration
workflow transitions
```

The MCP child receives the SDK safe/default inherited environment plus:

```text
MCP_ALLOWED_ROOT=<exact workspace target-app root>
```

It does **not** receive the parent `process.env` or `OPENAI_API_KEY`.

Path containment reuses the existing authoritative helper:

```text
resolveWithin(allowedRoot, relativePath)
```

Therefore:

- traversal fails closed;
- absolute paths fail closed;
- model-controlled root selection is impossible through the tool schema.

This is still not an OS sandbox. The MCP process has whatever remaining OS capabilities its process environment/account grants.

## Deterministic contract tests

`npm test` in `harness/`: **287 passed** at the recorded MCP01 review point.

MCP-specific coverage includes:

- real stdio Client ↔ Server path;
- protocol revision `2026-07-28`;
- `listTools()` discovers `repo_read_file`;
- valid `src/ok.ts` read succeeds;
- `../../../../etc/passwd` fails closed;
- `/etc/passwd` fails closed;
- missing file fails closed;
- empty Host allowlist discovers but denies the tool;
- valid narrow schema is admitted;
- broader `path` type is rejected;
- missing/open `additionalProperties` is rejected;
- root/credential fields are rejected;
- parent `OPENAI_API_KEY` is absent in the MCP child;
- Worker tool list removes `read_file` and exposes admitted `repo_read_file`.

The tests exercise the actual stdio protocol boundary rather than directly invoking the server handler.

## Bounded DEV run

Command:

```bash
npm run benchmark:mcp01
```

Task: T01, `contextMode=variant`, manual conversation state. One trial. No 3×3 comparison.

Evidence:

`docs/learning/lessons/23-mcp/traces/mcp01-t01-2026-09-24T09-05-18-835Z.txt`

Recorded result:

```text
protocol: 2026-07-28 / modern
admitted: repo_read_file
replaced direct tool: read_file

implementation:
  list_files        1
  repo_read_file    2
  read_file         0
  write_file        1
  run_command       1

VERIFY              PASS
independent REVIEW  pass (1 attempt)
workflow            success
wall                ~34s
```

Spec still used the normal direct read path. Repair was not needed.

For this recorded run, trace `tool_call` events are the authoritative evidence that implementation reads crossed MCP. The current `DiscoveryTracker` also treats successful `repo_read_file` calls as repository reads for later metrics.

## Frozen MCP01 PASS rule

MCP01 passes only if:

- a real MCP protocol path is used;
- current TypeScript SDK / 2026-07-28 path is used;
- `repo_read_file` is discovered through MCP;
- Host admission is explicit;
- valid allowed-root read succeeds;
- traversal/out-of-root attempts fail closed;
- Host can deny/non-expose a discovered capability;
- model does not control `allowedRoot`;
- model does not receive infrastructure credentials/config authority;
- one bounded Worker consumes an MCP result;
- writes remain direct/bounded;
- normal VERIFY remains authoritative;
- independent REVIEW remains authoritative.

Result: **PASS**.

## Topic Chat implementation review

Implementation review after cleanup: **PASS**.

No architecture or methodology blockers remain.

The probe demonstrates:

```text
MCP-backed capability works
AND
existing workflow authority is unchanged
```

It does **not** demonstrate that MCP improves model quality.

## Adoption decision for the current harness

Do **not** make MCP the default repository-read path.

For one local tightly-coupled `fs.readFile` capability, MCP adds:

- another process;
- protocol/serialization;
- discovery/admission plumbing;
- lifecycle and dependency overhead.

without solving a current interoperability problem.

Keep direct `read_file` as the default.

Use the MCP pattern when a future capability is genuinely a reusable/provider boundary, for example one GitHub/knowledge/database integration consumed by multiple AI Hosts.

## Non-goals retained

MCP01 intentionally did not add:

- HTTP deployment;
- OAuth;
- MCP Resources/Prompts;
- MRTR;
- sampling/roots;
- MCP write tools;
- repair/review MCP migration;
- multiple MCP servers;
- generic GitHub MCP integration;
- whole-harness MCP conversion;
- 3×3 qualification.


## Closure

Final understanding check passed. Two terminology corrections: MCP standardizes the broader integration/protocol surface, not Tools alone; and schema validity proves request shape, not safety/authorization. See `docs/learning/lessons/23-mcp/closure.md`.
