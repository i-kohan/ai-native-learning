# 25 — A2A01 notes

Status: mechanism implemented. A2A01 **PASS** as a mechanism probe. Default delegation stays off. Module 25 is not closed.

## Purpose

Show one real A2A v1 path:

```text
Worker delegate_remote_analysis
→ discover Agent Card
→ Host admission
→ SendMessage
→ separate harness-impact-agent
→ Task + ImpactAnalysis artifact
→ Host validates paths
→ advisory evidence
→ VERIFY and independent REVIEW stay in the parent harness
```

This does not claim that A2A improves quality, latency, or cost.

## Protocol pin

- Spec: A2A **1.0** (`https://a2a-protocol.org/v1.0.0/specification/`)
- SDK: `@a2a-js/sdk@1.0.1`
- Binding: HTTP+JSON (`RestTransportFactory`, `restHandler`)
- Card path: `/.well-known/agent-card.json`
- Skill: `repository-impact-analysis`
- Agent name: `harness-impact-agent`

The client does not import `buildImpactAgentCard`.

## Commands

```bash
cd harness
npm test
npm run benchmark:a2a01
```

`benchmark:a2a01` exits 2 when `A2A_REMOTE_OPENAI_API_KEY` is unset. It does not copy `OPENAI_API_KEY`.

## Deterministic results

Harness tests: **319 passed**, including 11 A2A tests.

Covered:

- card without `repository-impact-analysis` is discovered and rejected; the executor is not called
- protocol `0.3` is not admitted
- artifact path `../../secret.txt` is rejected and is not returned as advisory evidence
- a real HTTP Task id differs from the parent workflow id and from `delegationId`
- a completed Task does not set `grantsWorkflowSuccess`
- child env allowlist omits `OPENAI_API_KEY` and `GITHUB_TOKEN`
- a separate process serves the v1 card
- the remote episode tools are `list_files`, `read_file`, and `submit_impact_analysis`
- default Worker tools do not include `delegate_remote_analysis`
- durable mode rejects `a2aDelegationEnabled`

## A2A01 DEV probe

Evidence run on 2026-09-26: **PASS** as a mechanism probe. Exit 0. Module 25 is not closed.

The probe process received `A2A_REMOTE_OPENAI_API_KEY` as an explicit one-shot copy. The code does not fall back to `OPENAI_API_KEY`.

Two earlier runs died in Spec (`Request timed out.`, ~32.7 s) before delegation. Reports `traces/a2a01-t01-2026-09-26T12-20-29-676Z.txt` and `traces/a2a01-t01-2026-09-26T12-21-47-041Z.txt`. They are not the measurement.

Evidence workspace `T01-variant-manual-2026-09-26T15-47-26-326Z`, 35997 ms. Report `traces/a2a01-t01-2026-09-26T15-48-02-944Z.txt`. Trace `traces/T01-variant-manual-2026-09-26T15-47-26-326Z.jsonl`.

```text
workflowId:   T01-variant-manual-2026-09-26T15-47-26-326Z
delegationId: c8021fad-b3ed-407f-980e-946774f52bea
taskId:       a7870191-8e91-40b7-b961-1e0f2ee5422e
contextId:    23664de7-4c46-44e6-aa29-2962252e7924
remote_pid:   4075
admission:    pass
terminal:     TASK_STATE_COMPLETED
artifact:     accepted
VERIFY:       PASS
REVIEW:       pass
```

`delegate_remote_analysis` ran once (9370 ms) before `write_file`. The observation pointed at `getTask` returning status 500. The Worker then changed that branch to 404. `grantsWorkflowSuccess` stayed false.

`implementation_completed.a2aDelegations` and the outer `run_completed.a2aDelegations` are empty. `delegateRemoteAnalysis` returns `record`; the loop only stores `a2aDelegation`. The `a2a_delegation` event and the tool output still contain the record.

## Learning-critical surfaces

1. `buildImpactAgentCard` in `harness/src/a2a/impact-card.ts`
2. `performRemoteImpactDelegation` in `harness/src/a2a/host.ts` and `admitDiscoveredAgent` in `harness/src/a2a/admission.ts`
3. `buildImpactSendRequest` / task mapping in `harness/src/a2a/host.ts`
4. `admitImpactArtifact` in `harness/src/a2a/artifact.ts`
5. `formatImpactEvidence` plus `delegateRemoteAnalysis` / `executeRemoteAnalysisTool` in `harness/src/loop.ts`
