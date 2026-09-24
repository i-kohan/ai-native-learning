# 23 — MCP01 notes

Status: implemented, pending Topic Chat review. Module 23 is not closed.

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

Default harness behavior is unchanged. `mcpRepoReadEnabled` is experiment-only and applies only to the single implementation Worker. `list_files`, `write_file`, and `run_command` stay direct. Repair and review-repair keep direct `read_file`.

## Files

- `harness/src/mcp/repo-server.ts` — one tool, root from the environment
- `harness/src/mcp/repo-read-host.ts` — spawn, `listTools()`, admit, `callTool()`, close
- `harness/src/loop.ts` — opt-in routing
- `harness/src/mcp01-probe.ts` — one T01 DEV run
- `harness/tests/mcp-repo-read.test.ts`

Packages: `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `zod`.

## Deterministic tests

`npm test` in `harness/`: **287 passed**, including the MCP contract tests.

- real stdio Client ↔ Server
- `listTools()` finds `repo_read_file`
- `src/ok.ts` succeeds
- `../../../../etc/passwd`, `/etc/passwd`, and a missing file fail closed
- empty Host allowlist discovers the tool and denies the call
- schema must be an object with a plain string `path`, `additionalProperties: false`, and no `allowedRoot` / `root` / credential fields
- parent `OPENAI_API_KEY` is not visible to the child (the server exits if it is present; the session still connected)
- Worker tool list drops `read_file` and exposes admitted `repo_read_file`

## Bounded DEV run

Command: `npm run benchmark:mcp01`

Task: T01, `contextMode=variant`, manual conversation state. One trial. Not a 3×3.

Evidence: `docs/learning/lessons/23-mcp/traces/mcp01-t01-2026-09-24T09-05-18-835Z.txt`

Trace: `traces/T01-variant-manual-2026-09-24T09-04-43-810Z.jsonl`

```text
protocol 2026-07-28 / modern
admitted: repo_read_file
replaced: read_file
implementation tool calls:
  list_files 1
  repo_read_file 2
  write_file 1
  run_command 1
  read_file 0
VERIFY PASS
REVIEW pass (1 attempt)
workflow success
wall ~34s
```

Spec still used direct `read_file` (7 reads in the spec discovery metrics). That phase was not migrated.

The printed `impl_repo_tools read_file=0` on this run is the old discovery counter, which only recorded the direct tool name. The trace `tool_call` events are the evidence. After the run, successful `repo_read_file` calls are also recorded in that counter for later runs.

## MCP01

PASS against the frozen rule. Pending Topic Chat review. Not adopted as the default read path.

## Commands

```bash
cd harness
npm test
npm run benchmark:mcp01
```
