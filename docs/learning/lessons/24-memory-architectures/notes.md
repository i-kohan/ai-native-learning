# 24 — MEM01 notes

Status: implemented and measured. MEM01 **PASS**. Not closed. Default `runV1Harness()` does not read or write memory.

## Purpose

Show one repository-scoped fact moving across runs without becoming workflow authority:

```text
verified T02
→ harness admission
→ MemoryRecord
→ fresh T03
→ scope filter
→ current-tree validation
→ one advisory Worker hint
```

And the negative case: the same record is not injected when the anchor is gone.

## What the harness observes

`observeImplementationSurface()` reads `target-app/src/tasks/task-routes.ts`, finds `createTaskRoutes(service: Name)`, resolves that import, and checks that `export class Name` still defines every `service.method()` the routes call.

On this checkout that produces:

```text
Core task-domain operations are implemented by TaskService in target-app/src/tasks/task-service.ts
```

The class name and path are read from the files. A fixture whose routes delegate to `TaskOps` produces a `TaskOps` claim instead.

## Admission

`proposeMemoryCandidate()` returns nothing unless workflow status is success, verification passed, and review outcome is `pass`. `admitMemory()` re-reads the tree and rejects a claim that does not match that observation, including a statement rewritten after the fact.

The persisted record keeps `sourceFingerprint` as provenance. Later validation does not require the same bytes.

## Retrieval

`retrieveWorkerMemory()` loads the store, keeps only `repositoryScope`, and validates each in-scope record. Exactly one valid record becomes the hint. Zero or several valid records inject nothing.

The hint says the Spec and the current tree stay authoritative, and that `list_files` / `read_file` remain available.

## Commands

```bash
npm test --prefix harness
npm run benchmark:mem01
```

Harness tests on 2026-09-25: **301 passed**.

## MEM01 (2026-09-25)

| Step | Result |
| ---- | ------ |
| T02 | success, VERIFY PASS, REVIEW pass, 1 admitted record |
| other scope | retrieved 0, injected 0 |
| T03 | new manual run, 0 `previous_response_id`, retrieved 1, validated 1, injected 604 bytes |
| stale worktree | class removed, `anchor_missing`, injected 0, record unchanged |

T03 implementation still called `read_file` 6 times. `implNavCallsBeforeFirstWrite` was 6. No quality claim.

Evidence:

- `docs/learning/lessons/24-memory-architectures/traces/mem01-2026-09-25T18-53-45-685Z.txt`
- `docs/learning/lessons/24-memory-architectures/traces/mem01-store-2026-09-25T18-53-45-685Z/mem-b8b23946ff9d0136.json`

## Adoption

Leave memory off by default. The probe shows admission, scope, validation, injection, and stale rejection. It does not show that the hint replaces discovery or improves the workflow.
