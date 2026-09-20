# Module 21 — Optional Browser QA — Master Decision

**Status:** ⏭ SKIPPED / NOT APPLICABLE on 2026-09-20.

## Decision

Do not implement Browser / Visual QA in the current capstone.

The current `target-app` has no meaningful browser/UI surface. Its package only exposes the TypeScript test harness; the learning workload is API/service-oriented rather than user-interface-oriented.

The Master Plan explicitly defines Browser / Visual QA as conditional:

> If the capstone repository has meaningful UI, include it. If not, do not force it just to check a box.

Building a toy page, adding a browser stack, and then automating clicks solely to satisfy Module 21 would create workload and architecture that the real capstone does not currently need.

## What remains understood

For a genuine UI task, browser-observable state can be stronger acceptance evidence than model self-review and may complement unit/integration tests.

A future Browser QA workflow would likely fit as:

```text
UI artifact
→ deterministic/server setup
→ browser action
→ observable DOM / URL / network / visual evidence
→ harness-owned acceptance
```

Browser output remains evidence; it does not become workflow authority by itself.

## Revisit trigger

Reopen Module 21 only when a real workload introduces meaningful UI behavior, for example:

- a React/web application becomes part of the capstone;
- an acceptance criterion is best verified through browser-observable behavior;
- visual/layout regressions become a real failure mode.

At that point, implement Browser QA against the real UI workload rather than a synthetic demo.

## Roadmap consequence

Module 21 is not an unfinished blocker.

```text
20 GitHub / CI Integration  = completed
21 Optional Browser QA      = skipped / conditional
22 Bounded Parallel Fan-Out = next
```
