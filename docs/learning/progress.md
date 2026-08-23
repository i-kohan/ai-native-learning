# Learning Progress

## Current state

Completed modules:

1. ✅ 01 — Agent Loop & Harness
2. ✅ 02 — Spec-Driven Development
3. ✅ 03 — Context Engineering
4. ✅ 04 — Verification + bounded Repair
5. ✅ 05 — Independent Review + bounded Review Repair
6. ✅ 06 — Tracing & Evals
7. ✅ 07 — Skills
8. ✅ 08 — Worktrees / Isolation

Current harness: **V3 Spec-Driven + targeted context + bounded verify/repair + independent review**, with:

- systematic measurement: `HarnessRunResult → RunMetrics → EvalResult`;
- one reusable procedural Skill: `evidence-guided-repair`, selectively loaded only for `repair` / `review_repair`;
- per-run Git worktree isolation for benchmark/eval execution;
- exact workspace provenance via `baseRevision`;
- workspace-bound `repoRoot / targetAppRoot / targetSrcRoot`, so tools/context/snapshots/verifier operate on the run's workspace.

Current execution flow:

```text
raw task
→ create isolated workspace from exact committed SHA
→ bind harness roots to workspace
→ deterministic context preparation / repo orientation
→ read-only spec phase
→ SpecDecision
   ├─ needs_human_judgment → stop before coding side effects
   └─ executable
       → implementation episode
       → harness-owned VERIFY / bounded repair
          ├─ cannot reach PASS → stop
          └─ PASS
             → independent REVIEW #1
                ├─ no accepted blocker → success
                └─ accepted blocker
                   → one review repair
                   → deterministic VERIFY again
                   → REVIEW #2
                      ├─ pass → success
                      └─ accepted blocker → stop
→ collect durable traces/eval evidence on host
→ cleanup isolated workspace
```

Measurement layer:

```text
HarnessRunResult / raw traces
→ semantic normalization
→ RunMetrics
→ fixed-suite aggregation
→ EvalResult + report
→ engineering decision
```

Detailed evidence lives in `docs/learning/experiments.md` and `docs/learning/lessons/*`.

## Next module

**09 — Security fundamentals**

Why now:

- the current `master-learning-plan.md` places Security fundamentals immediately after Worktrees / Isolation in Phase 2 — Reliable Autonomy;
- Module 08 now gives each run separate mutable Git/filesystem state, but a worktree is explicitly **not** a security boundary;
- the agent may still read hostile repository content, execute dangerous commands, access host files/secrets, use network access, or perform unauthorized side effects unless capabilities are constrained;
- the next step is therefore to add a minimal explicit threat model + least-privilege capability/security boundary around the existing isolated execution, without prematurely building production sandbox infrastructure.

Target after Module 09: **V5-style safe-autonomy boundary** for this capstone: current V3 + measurement + Skills + worktree isolation + explicit practical security controls/threat model appropriate to the current harness.

After Module 09, return to the current roadmap and enter Phase 3 with **Model Routing**. Do not start routing before Security is formally closed.

---

## Module: 08 — Worktrees / Isolation

**Status:** ✅ COMPLETED — formally closed by Master on 2026-08-23.

Theory: `docs/learning/lessons/08-worktrees-isolation/theory.md`  
Practical notes + evidence: `docs/learning/lessons/08-worktrees-isolation/`

### Built

- `Workspace { id, root, baseRevision, ref }`;
- `resolveBaseRevision`, `createWorkspace`, `bindConfig`, `cleanupWorkspace`;
- detached per-run Git worktrees from an exact committed SHA;
- benchmark/eval fixture setup inside the isolated workspace rather than shared main `target-app/src`;
- workspace binding reused by normal T01–T04, R01 and REV01 paths rather than implemented only in ISO01;
- host-side durable traces/eval artifacts retained outside ephemeral worktrees;
- ISO01 deterministic workspace-isolation mechanism probe;
- eval/report semantics that keep ISO01 separate from capability denominators and fixed V3 `6/6` contracts.

### ISO01 evidence

`docs/learning/lessons/08-worktrees-isolation/traces/ISO01-isolation-2026-08-23T11-06-42-372Z.json`

Observed:

```text
Workspace A base SHA == Workspace B base SHA
→ yes

mutate source only in A
→ mutation visible in A
→ absent in B
→ absent in main checkout

VERIFY(A)
→ FAIL (500 !== 404)

VERIFY(B)
→ PASS

cleanup A/B
→ success

cleanup retry
→ safe
```

The verifier result is intentionally observable evidence of workspace binding rather than merely checking a different cwd/path.

### Fresh regression evidence

`docs/learning/lessons/08-worktrees-isolation/traces/2026-08-23T11-09-29-281Z.txt`

```text
ISO01 workspace isolation    PASS
T01–T04 expected outcomes    4 / 4
Executable first-pass        3 / 3
Correct escalation T04       1 / 1
R01 verification repair      PASS
REV01 independent review     PASS
All fixed V3 contracts       6 / 6
Hard regressions             none
```

ISO01 remains an isolation/mechanism result; it is not included in capability first-pass or task-success denominators and does not turn `6/6` into `7/7`.

### Master closure

Module 08 satisfies the intended Worktrees / Isolation goal:

- independent mutable source state is demonstrated for two runs from the same exact base revision;
- main checkout is not polluted by isolated run mutations;
- tools/context/snapshots/verifier inherit the workspace via one root-binding boundary instead of phase-specific worktree logic;
- verifier binding is demonstrated by A FAIL / B PASS against intentionally different workspace states;
- workspace cleanup is explicit and retry-safe;
- exact provenance is carried by `baseRevision`;
- existing V3 capability and repair/review contracts remain intact;
- isolation evidence remains semantically separate from capability metrics;
- implementation deliberately stops at Git/filesystem isolation and does not overclaim sandbox/security properties.

No additional workspace infrastructure is required before moving on.

### Known non-blocking limits

1. Worktree provides Git/filesystem working-state isolation, not process/network/secret/security containment.
2. `target-app/node_modules` is shared with the host via symlink, so dependency installation is not isolated.
3. Manual `npm start` still uses the main checkout; isolated execution is integrated into benchmark/eval paths.
4. Worktrees use committed state: dirty/uncommitted host changes are not included.
5. `Workspace.ref` currently records the requested source ref (`HEAD`); exact execution provenance is `baseRevision`.
6. Crash recovery, TTL, leases and distributed cleanup remain later orchestration concerns.

---

## Prior completed modules — compact recap

### 07 — Skills

One reusable `evidence-guided-repair` procedural Skill is selectively loaded only for verification-repair/review-repair episodes. Spec/repo truth/tools/policy/VERIFY/review remain separate authority layers. Fixed suite remained 6/6 with no disclosure diagnostics.

### 06 — Tracing & Evals

Structured `HarnessRunResult → RunMetrics → EvalResult`; capability tasks separated from controlled mechanism probes; benchmark denominators/N/A states explicit; recurring findings aggregated without inventing unavailable ground truth.

### 05 — Independent Review

A deterministic-green architecture defect can be caught by fresh artifact-focused review, passed through harness-owned finding policy, repaired once, re-verified and re-reviewed.

### 04 — Verification + Repair

External deterministic FAIL becomes factual evidence → bounded repair → mandatory re-verification. Harness, not model prose, owns completion.

### 03 — Context Engineering

Targeted orientation and spec→implementation reuse reduced blind discovery while preserving correctness and ambiguity escalation.

### 02 — Spec-Driven Development

Read-only structured spec + explicit `executable | needs_human_judgment` gate prevents unauthorized product invention before coding side effects.

### 01 — Agent Loop & Harness

Explicit model → tool → observation loop, bounded tools, external verification and traces established the base harness.
