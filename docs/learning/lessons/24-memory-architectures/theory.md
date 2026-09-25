# 24 — Verified repository memory

## Mental model

Repository memory here is one durable fact about this repository, not the model's conversation and not the workflow's current phase.

```text
ephemeral context     = what this inference sees
episode / conversation = how this Worker continues
WorkflowState         = which semantic phase is committed
MemoryRecord          = a fact admitted from a verified run, checked again before reuse
```

A fact becomes memory only after the harness has supported evidence. On the next run the harness asks whether that fact still matches this tree. If it cannot tell, it does not inject the fact.

## Flow

```text
Spec → Worker → VERIFY PASS → independent REVIEW pass
→ observe the current implementation surface
→ admit and persist one MemoryRecord

later run, new episode, no previous_response_id
→ harness derives repository scope from config.repoRoot
→ keep records for that scope
→ validate the claim against the current files
→ either one advisory Worker hint, or no hint
```

For MEM01 the claim is structural: task routes delegate domain operations to a class, and that class still defines those operations. The source path must exist. A full-file hash is kept so we know what was seen, but a harmless edit does not by itself make the claim false.

## Boundaries

- The resolved Spec stays the authority for required behavior.
- The current repository stays the authority for what the code is.
- VERIFY and independent REVIEW still decide the workflow.
- Memory does not write `WorkflowState`.
- Durable execution does not run memory promotion or retrieval. Requesting both is rejected.
- The hint does not remove `list_files` or `read_file`.
- Model text is not admitted as memory.

This is not a vector index, an embedding search, or a store of every trace.

## Failures and trade-offs

Fail closed. Missing path, missing class, a moved surface, or two valid records means no injection. The stored record is not rewritten from a failed check.

A narrow structural check can miss a semantic change that keeps the same class and methods. A byte-identical check would reject harmless edits and would have rejected T03, whose `task-service.ts` is not the T02 bytes. The structural check is the smaller lie for this one fact.

Memory that is always on would spend context on facts the Worker can rediscover. This probe keeps the seam opt-in.

## Observations from this module

1. The admitted statement matched the class and path read from the current routes and service file, after T02 had VERIFY PASS and REVIEW pass.
2. T03 was a new manual run with no `previous_response_id`. Scope filtering dropped the record for a different repository, and the in-scope record was injected only after validation.
3. Replacing `TaskService` in an isolated worktree produced `anchor_missing`, no hint, and the same stored record.
4. After injection, the T03 Worker still called `read_file` six times. The hint did not become the only way to see the repository.

## Takeaways

- Persist a verified fact, not the model's narration of it.
- Check the fact against the tree you are about to use.
- A memory hint is context, not a phase transition and not a spec.
- If applicability is unclear, inject nothing.
- One successful probe is not a reason to turn memory on for every run.
