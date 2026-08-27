# 12 — Planner / Worker / Reviewer

Короткий refresher. Не дублирует master/research.

## Mental model

Spec = authority. Plan = hypothesis. Diff+VERIFY = факты для Reviewer.

Planner не исполняет. Worker не обязан следовать Plan. Reviewer не судит Plan. Outer harness решает, запускать ли фазы.

## Flow

```text
resolved Spec
  → [optional] read-only Planner → submit_plan → admission
  → Worker (Spec отдельно + advisory Plan)
  → VERIFY / bounded repair
  → independent REVIEW (без Plan) / bounded review repair
```

`dependsOn` — semantic ordering, не DAG executor. Admission отклоняет циклы (не только self-dep). `likelyFiles` — hints, не allowlist.

## Boundaries

- Planner: `list_files`, `read_file`, `submit_plan`. Нет write/run.
- Plan не расширяет product semantics / tools / scope.
- Reviewer: Spec + diff + constraints + VERIFY evidence.
- Default: Planner выключен (`planningEnabled=false`).

## Failures / trade-offs

Upfront Plan может быть полезен на большой decomposition и вреден, когда задача уже умещается в один Worker episode: лишний model/tool/token/wall cost без выигрыша в correctness.

Не путать Worker-local savings с end-to-end выигрышем. Quality equal + directional e2e better без заранее заданного numeric threshold → inconclusive, не candidate.

## Observations from P01

1. Оба arm 3/3 expected, first VERIFY PASS, 0 repair / 0 review-repair.
2. Variant дороже e2e по всем собранным сигналам: model calls 8→12, tool calls 23→31, input ~37k→57k, output ~3.7k→5.3k, wall ~51s→64s.
3. Worker на variant не стал дешевле (5→7 model calls). Planner добавил ~2 calls / ~8 tools.
4. likelyFiles иногда включали tests/package.json; Worker их не менял — Plan не стал edit authority.

## Takeaways

- Явный Planner — отдельный episode с отдельным tool boundary, не «ещё один prompt».
- Admission должен быть deterministic schema, не второй LLM.
- Reviewer independence ломается, если дать ему Plan или Worker rationale.
- Quality equal + e2e cost higher → reject. Directional e2e better без predefined meaningful threshold → inconclusive. Не включать Planner по умолчанию без evidence.
- n=3 — learning evidence, не qualification.
