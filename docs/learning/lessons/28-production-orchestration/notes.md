# Module 28 — Practical Notes

## Current harness → production mapping

Current logical flow:

```text
raw task
→ isolated workspace
→ Spec
→ Implementation
→ VERIFY / bounded repair
→ independent REVIEW / bounded repair
→ optional GitHub delivery / CI
```

Possible workflow-engine mapping:

```text
CodingWorkflow
├─ Spec Activity
├─ Implementation Activity
├─ Verify Activity
│  └─ optional Repair Activity
├─ Review Activity
│  └─ optional ReviewRepair Activity
├─ Delivery Activity
└─ wait for CI / human / timer
```

Do not interpret Activity completion as software correctness.

## What the engine could own

- durable execution history/state;
- Task Queues and Worker dispatch;
- task redelivery and infrastructure retry timing;
- durable timers/events;
- heartbeat/liveness;
- Worker-loss recovery;
- deployment/version routing;
- workflow-fleet visibility;
- queue/concurrency/backpressure primitives.

## What remains harness-owned

- Spec semantics;
- model/prompt/context/tool policy;
- workspace reconstruction and authority;
- VERIFY semantics;
- REVIEW semantics;
- repair classification and budgets;
- external side-effect safety;
- GitHub reconciliation;
- human escalation;
- final software-correctness consequences.

## Current gap map

| Area | Current support | Production gap |
| --- | --- | --- |
| Persistence | semantic WorkflowState checkpoints | no distributed history/control plane |
| Scheduling | direct harness flow | no distributed scheduler |
| Task delivery | local calls | no Task Queue / Worker fleet |
| Retry | bounded operation-specific retry | no distributed redelivery service |
| Ownership | single-machine lease + WorkflowState fencing | no cross-machine execution authority |
| Side effects | explicit classification; DeliveryState reconciliation | workspace/GitHub effects remain external |
| Liveness | lease TTL | no Activity heartbeat model |
| Cancellation | local control | no durable cooperative cancellation |
| Backpressure | unnecessary today | no queue/concurrency/rate policy |
| Versioning | schemaVersion | no live workflow/Worker-version coexistence |
| Observability | per-run traces/evals | no fleet/queue observability |
| Multi-tenancy | not required | no fairness/quota model |

## Side-effect / retry matrix

| Operation | Blind retry? | Idempotency | Reconciliation |
| --- | --- | --- | --- |
| Read-only repo analysis | usually yes | not needed | no |
| LLM read-only analysis | usually yes | useful for dedup/cost | rarely |
| Spec generation | usually yes | useful | rarely |
| Implementation/file writes | no by default | difficult | reset/checkpoint/reconcile |
| VERIFY/tests | usually yes if local/read-only | usually not needed | only if tests touch externals |
| REVIEW | usually yes | useful for dedup/cost | rarely |
| git commit | cautious | stable artifact identity | inspect HEAD/tree |
| git push | no blind retry | expected ref/SHA | yes |
| create/update PR | no blind retry | stable logical identity if available | yes |
| CI observation | yes | N/A | compare exact expected SHA |

## Workspace failure policy

Mid-Implementation:

```text
durable state says implementation_ready
but workspace may contain partial mutation
```

Default current-policy direction:

```text
do not blindly continue dirty workspace
→ restore last authoritative checkpoint
→ retry/re-run
```

Use reconciliation when external state may already have changed and cannot simply be discarded.

Mid-VERIFY is more replayable when verification itself is side-effect-free.

## Operational distinctions retained

```text
waiting for a Worker
!=
Worker started but hung

heartbeat
!=
semantic checkpoint

task redelivery
!=
external exactly-once

episode trace
!=
workflow-fleet observability

logical agent topology
!=
physical orchestration topology
```

Modules 26–27 concern how reasoning is decomposed among agents. Module 28 concerns how long-lived execution is scheduled, recovered, routed, versioned, and operated across processes/machines. They are orthogonal dimensions.
