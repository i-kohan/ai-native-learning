# Final Capstone Review

Date: 2026-10-05

Status: **29-module roadmap complete.**

This document is the final consolidation of the AI-native / agentic engineering learning cycle.

## 1. Roadmap coverage

The numbered roadmap covered Modules 01–29.

- **28 modules were completed.**
- **Module 21 — Optional Browser QA was intentionally skipped / not applicable** because the current capstone has no meaningful UI workload.
- Modules 27 and 28 were **not skipped**: both were completed with an evidence-based decision that no implementation was justified for the current workload.
- Module 29 was **not skipped**: META01 ran a real bounded candidate cycle and rejected H1 under the frozen admission rule.
- There is no Module 30 implied by the current master plan.

## 2. Final retained mental model

```text
human intent / issue
→ targeted context
→ read-only Spec / ambiguity gate
→ one implementation Worker
→ deterministic VERIFY
→ bounded verification repair
→ independent REVIEW
→ bounded review repair
→ measured outcome
→ optional delivery / external workflow integration
```

Around it:

```text
workspace provenance
permissions / security
model routing
durable semantic state
retry policy
tracing / evals
human escalation
```

> The model owns an attempt. The outer harness owns authority, evidence, and workflow consequence.

> Do not automate the human. Automate the feedback loop.

## 3. Architecture decision matrix

| Mechanism | Final status | Default? | Revisit trigger |
| --- | --- | --- | --- |
| Agent loop + harness | retained core | yes | n/a |
| Spec / ambiguity gate | retained core | yes | n/a |
| Targeted context | retained core | yes in normal CLI | provider/context economics change |
| VERIFY + bounded repair | retained core | yes | n/a |
| Independent REVIEW + repair | retained core | yes | n/a |
| Tracing / eval normalization | retained core | yes | n/a |
| Evidence-guided repair Skill | retained | selective | repeated procedure changes |
| Worktree isolation | retained for benchmark/eval | yes there | stronger containment need |
| Model routing boundary | retained boundary | yes | real task-class/model economics |
| Provider continuation | experimental seam | no | long episodes / provider economics |
| Explicit Planner | rejected as default | no | larger planning-sensitive workload |
| Research Subagent | experimental seam | no | real bounded research subproblem |
| Human-reviewable decomposition | conditional | no | measurable human-review benefit |
| Strong eval methodology | retained methodology | yes | broaden task distribution |
| Durable checkpoints / resume | opt-in mechanism | no | real long-running workflows |
| Review-ready checkpoint | opt-in mechanism | no | same |
| REVIEW retry semantics | opt-in mechanism | no | broader retry classes |
| Lease / fencing | opt-in mechanism | no | cross-machine / fenced-resource need |
| GitHub / CI delivery | opt-in production-shaped seam | no | real SDLC deployment |
| Browser QA | skipped / not applicable | no | real UI workload |
| Parallel implementation fan-out | not adopted | no | low-coupling independent changes + wall-time need |
| MCP repository read | conditional boundary | no | reusable/external capability provider |
| Verified repository memory | conditional | no | repeated expensive cross-run rediscovery |
| A2A delegation | conditional boundary | no | independently operated remote agent |
| Shallow multi-agent investigation | mechanism PASS, not adopted | no | breadth-first workload with measured advantage |
| Deep hierarchy | no implementation justified | no | measured coordinator degradation + natural subtrees |
| Distributed workflow engine | no implementation justified now | no | long-lived multi-worker production triggers |
| META01 self-improvement loop | learning/control-plane probe | no | real bounded improvement target + fresh eval |

## 4. What the project actually proved

The strongest result is the engineering loop:

```text
observe failure / cost
→ classify the failing layer
→ form a bounded hypothesis
→ change one mechanism
→ preserve authority boundaries
→ run controlled evidence
→ retain / reject / keep conditional
```

Several advanced mechanisms were deliberately not adopted after measurement. That is evidence of successful eval-driven engineering, not incomplete implementation.

## 5. Current production-shaped core vs learning harness

The repository now serves two purposes:

1. a usable small coding-agent harness;
2. an archive of controlled learning experiments.

`runV1Harness()` still contains experiment switches for Planner, Subagent, MCP, A2A, memory, ReviewPlan, fan-out and durability. This was useful during learning, but a production-shaped harness should have a smaller normal API and move experiment-only plumbing behind dedicated runners/adapters.

Do not delete these seams blindly. First decide whether the repository remains primarily a learning artifact or becomes a production/portfolio harness.

## 6. Highest-priority cleanup / technical debt

### P1 — normal API defaults

`runV1Harness()` still defaults low-level `contextMode` to `baseline`, while the normal CLI explicitly selects `variant`.

If productionized:

```text
targeted context = normal API default
baseline         = explicit ablation only
```

### P1 — workspace ownership

Benchmark/eval runners create isolated exact-base worktrees, but the simple manual CLI can run directly against the configured repository. A production entrypoint should own workspace creation/isolation.

### P1 — split experiment seams from normal orchestration

`run.ts` and `loop.ts` accumulated optional learning mechanisms. A production-shaped cleanup should separate the normal Spec → Worker → VERIFY → REVIEW path from experiment adapters/runners.

### P1 — hostile-code containment

Current worktree isolation and secret allowlists are not a general sandbox. A real production coding agent would need stronger process/container/network containment for untrusted repository code.

### P2 — benchmark breadth

The eval methodology is stronger than the task distribution. Future coverage should grow through real tasks rather than synthetic breadth for its own sake.

### P2 — durable execution gaps

Still intentionally unresolved:

- mid-Worker crash reconciliation;
- workspace/tool side-effect fencing;
- generic external side-effect reconciliation;
- automatic heartbeat/liveness;
- cross-machine scheduler / Task Queue;
- worker/version coexistence.

ORCH01 says not to build these until real workload triggers exist.

### P2 — provider provenance

Configured model identity is recorded, but provider changes behind a stable alias cannot be fully detected.

### P2 — META01 authority coverage

The META01 authority suite documents a narrow blind spot around exhaustive verification of the real MCP-admitted replacement path. This is acceptable for the learning probe, not production-grade proof.

## 7. Capability assessment

### Strong / demonstrated

- harness and agent-loop architecture;
- authority separation: model vs harness vs verifier/reviewer;
- spec-driven execution;
- context engineering;
- deterministic verification and bounded repair;
- independent review;
- tracing / eval design;
- experimental methodology and rejection discipline;
- worktree/provenance reasoning;
- security/capability reasoning;
- retry / checkpoint / ownership mental models;
- deciding not to adopt advanced mechanisms without evidence.

### Practical bounded implementation experience

- durable semantic state;
- leases/fencing;
- GitHub / CI reconciliation;
- MCP;
- verified memory;
- A2A;
- shallow multi-agent systems;
- self-modification control plane.

### Under-tested / not production-proven

- hostile-code sandboxing;
- browser/visual QA;
- large real-world task distribution;
- multi-repository autonomous work;
- real distributed worker fleet;
- backpressure / multi-tenancy / fleet operations;
- production workflow-engine integration;
- deep hierarchy at meaningful scale;
- recursive self-improvement.

## 8. Recommended next phase

Do not add more roadmap modules.

### Phase A — one cleanup pass

1. Decide whether this repository is a **learning reference harness** or a **production-shaped portfolio harness**.
2. If production-shaped, shrink the normal API and move experiment wiring out of the core path.
3. Make targeted context and workspace isolation safe defaults.
4. Refresh README / architecture entrypoints.
5. Keep historical experiments intact.

### Phase B — apply the system to a real repository

Stop choosing tasks because they demonstrate a module.

```text
real issue
→ Spec
→ autonomous implementation
→ VERIFY / REVIEW
→ PR / CI
→ human review
```

Collect failures and improve the harness only when those failures justify a mechanism.

### Phase C — portfolio / interview artifact

The strongest story is not "I implemented 29 agent features."

> I built one coding-agent harness, introduced mechanisms one at a time, measured them, rejected several fashionable patterns when they did not improve the workload, and kept authority/evaluation outside the model.

Useful final artifacts:

- concise architecture diagram;
- this decision matrix;
- 3–5 representative experiment stories;
- one real end-to-end PR/CI case study;
- explicit limitations / production migration triggers.

## 9. Final conclusion

The planned learning cycle is complete.

The next improvement should come from **real workload evidence**, not from extending the topic list.
