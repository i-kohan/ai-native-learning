# 23 — MCP Deeper Dive closure

Status: **✅ COMPLETED — closed by Topic Chat on 2026-09-24.**

## Practical result

MCP01 **PASS** as a bounded mechanism probe.

The harness consumed one repository-read capability through a real MCP Client ↔ Server stdio boundary while keeping Spec, writes, VERIFY, REVIEW, retry/repair policy, workspace ownership, and workflow success under harness authority.

Default repository reads remain direct. MCP stays opt-in evidence/pattern for reusable or externally owned capability boundaries.

## Final understanding check

The learner correctly identified that:

- MCP standardizes a reusable integration/protocol surface between Host/Client and Server, rather than taking orchestration authority;
- discovery does not imply permission: the Host/harness still decides which discovered capabilities are admitted and exposed to a Worker;
- direct integration is preferable for tightly coupled local internals such as `runFinalVerification() → npm test`;
- MCP becomes more valuable when one integration should be reused by multiple Hosts, such as a shared GitHub capability provider;
- in MCP01 the model chooses the relative `path`, while the Host chooses `allowedRoot`;
- credentials belong in Host/Server infrastructure rather than model context;
- the harness still decides workflow success through its normal VERIFY / independent REVIEW lifecycle.

Two terminology corrections were made during the check:

1. MCP standardizes more than Tools alone: it also covers Resources/Prompts and the common discovery/schema/invocation/transport boundary.
2. `schema-valid ≠ safe` even for a trusted server. A destructive operation may be structurally valid but still unauthorized or inappropriate. Untrusted/malicious server output is a separate security concern.

## Module decision

```text
MCP mechanism               = implemented + reviewed + understood
MCP01                       = PASS
default local repo read      = direct
MCP adoption                 = conditional at reusable/provider boundaries
workflow authority           = remains in harness
Module 23                    = CLOSED
```

No further MCP work is required before returning to Master for next-module selection.
