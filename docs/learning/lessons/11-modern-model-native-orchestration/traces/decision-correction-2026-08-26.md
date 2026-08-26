# Module 11 — decision correction (2026-08-26)

## Why this file exists

The original experiment artifact:

`orchestration-m11-2026-08-26T11-33-10-801Z.txt`

is preserved unchanged as historical evidence of what the experiment runner reported at the time.

That original report ended with:

```text
no_clear_regression: yes
candidate_to_adopt: yes
```

After Topic Chat review, that interpretation was found to be too strong.

## What was wrong with the original decision logic

The experiment contract said adoption required:

> no clear repeated token/latency/failure regression

But no quantitative token/latency threshold had been defined before the run.

The first implementation of the evaluator added post-hoc thresholds:

```text
input tokens regression only if > 1.5x
wall-time regression only if > 2x
```

Those thresholds were not part of the predefined experiment contract. Therefore they must not be used to convert the observed result into a pass.

Observed averages were:

```text
manual:
  input tokens ~17,178
  wall time    ~23.6s

previous_response_id:
  input tokens ~19,831   (~+15%)
  wall time    ~32.3s    (~+37%)
```

With only `n=3` trials per arm, these observations are not strong enough to prove a stable efficiency regression either.

Therefore criterion 6 is:

```text
INCONCLUSIVE
```

not `PASS` and not `FAIL`.

## Correct interpretation

Criteria supported by evidence:

1. `previous_response_id` T02 correctness: 3/3.
2. Client full-history replay is removed in the variant.
3. Tool/workspace/security authority remains client/harness-owned.
4. Tool-call observability remains intact.
5. Client conversation payload decreases materially: about 43 → 7 items and 53 KB → 14 KB.

Criterion not resolved by this experiment:

6. Token/latency efficiency: **inconclusive**.

Final engineering decision:

```text
Mechanism: supported
Correctness: preserved on tested workload
Outer authority: preserved
Client replay reduction: supported
Token/latency effect: inconclusive
Default change: not justified
```

Therefore:

```text
conversationStateMode default = manual
previous_response_id = implemented/selectable variant
```

## Why the original artifact is not rewritten

Evidence artifacts should remain immutable where practical. Rewriting the original report would erase the fact that the first evaluator made an overly permissive post-hoc decision.

This correction supersedes only the **interpretation/adoption decision** in that artifact. It does not invalidate the raw trial metrics, traces, correctness results, or fixed-suite evidence.

## Current authoritative interpretation

Use these documents for the current conclusion:

- `docs/learning/experiments.md` — Module 11 section
- `docs/learning/lessons/11-modern-model-native-orchestration/notes.md`
- this correction file

The raw report remains useful historical evidence, but its final `candidate_to_adopt: yes` line is superseded by this correction.
