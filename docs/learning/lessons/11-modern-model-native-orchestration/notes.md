# 11 — Modern model-native orchestration (inner vs outer loop)

Практический журнал. Bounded experiment: `previous_response_id` vs ручной replay истории внутри `runAgentLoop`. Formal closure и `theory.md` остаются за Topic Chat.

## Что это за урок одной фразой

Провайдер может владеть **временным continuation state внутри эпизода**. Outer harness по-прежнему владеет workspace, VERIFY, repair/review policy, tools и workflow success.

## Что сдвинулось внутрь

Между ходами одного `runAgentLoop` conversation/reasoning continuation больше не replay-ится клиентом целиком. Следующий Responses-вызов ссылается на `previous_response_id` и шлёт только новые `function_call_output`.

## Что явно осталось outer

- workspace / exact `baseRevision` / worktree isolation
- model routing
- spec gate
- deterministic VERIFY
- repair / review / review-repair policy
- path/`run_command` restrictions
- verification child env
- Skill loading
- final workflow status
- eval scoring

Терминальный ответ модели = stop эпизода, не success workflow.

## Почему `previous_response_id` — episode state, не workflow state

Каждый вызов `runAgentLoop` начинает новую цепочку с `previousResponseId = null`.

```text
implementation: A → B → C → STOP
repair:         D → E → STOP          (не продолжает C)
review_repair:  F → … → STOP          (не продолжает E)
```

Response IDs не являются durable workflow state, checkpoint или resume.

## Почему custom tools остаются client-owned

`previous_response_id` не исполняет наши tools. Harness по-прежнему:

1. читает `function_call` из `response.output`;
2. вызывает `executeTool()`;
3. возвращает `function_call_output` как единственный новый input следующего хода.

Path/`run_command` restrictions не менялись.

## Как устроено

```text
conversationStateMode = previous_response_id | manual   (default после эксперимента: previous_response_id)

manual:
  input = accumulated history including response.output + tool outputs

previous_response_id:
  first:  input=task, previous_response_id unset
  later:  previous_response_id=last.id, input=only new function_call_output
```

Команды:

- `cd harness && npm test`
- `cd harness && npm run benchmark:orchestration`
- `cd harness && npm run benchmark:eval`
- сравнение с baseline: `npm run benchmark:eval -- --manual-conversation`

## Файлы, которые стоит лично посмотреть

1. `harness/src/loop.ts` — `buildResponsesRequest` / `applyModelOutput` / `applyToolOutputs`
2. `harness/src/loop.ts` — локальный `executeTool()` после `function_call`
3. `harness/src/run.ts` — `runVerifyRepairLoop` (outer VERIFY/repair не менялся)
4. `harness/src/tools.ts` — `executeTool` / path restrictions
5. `docs/learning/lessons/11-modern-model-native-orchestration/traces/T02-orch-previous_response_id-1-2026-08-26T11-34-23-995Z.jsonl` — A→B→C chain

## Experiment (2026-08-26)

T02, `contextMode=variant`, 3 valid trials / arm.

| Arm | expected | client items/bytes avg | tokens in/out avg | wall avg |
| --- | -------- | ---------------------- | ----------------- | -------- |
| manual | 3/3 | 43 / 53349 | 17178 / 1570 | ~24s |
| previous_response_id | 3/3 | 7 / 14315 | 19831 / 1888 | ~32s |

Decision rule: **passed**. Adopted as default.

## V3 regression (fixed-v3-m09, previous_response_id)

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01                         PASS
REV01                       PASS
All fixed V3 contracts      6 / 6
ISO01                       PASS
SEC01                       PASS
Hard regressions            none
```

Harness tests: 104 passed.

## Нюансы

- Client replay/items/bytes упали; billed input tokens **не** упали. Провайдер всё равно считает continuation; в traces видны `cached_tokens`.
- Wall time на n=3 выше у variant — не интерпретировать как доказанный latency regression.
- `instructions` и tool definitions resend на каждый Responses request.
- Spec-phase и reviewer loop **не** переведены на `previous_response_id` (эксперимент только `runAgentLoop`).
- Не добавлялись Agents SDK, PTC, hosted shell, Sessions API, MCP, subagents, planner/worker, durable execution.

## Evidence paths

- 3×3 report: `traces/orchestration-m11-2026-08-26T11-33-10-801Z.txt`
- chain: `traces/T02-orch-previous_response_id-1-2026-08-26T11-34-23-995Z.jsonl`
- fixed suite: `traces/2026-08-26T11-39-08-076Z.txt`

`theory.md` не писать до Topic Chat.

## Personal takeaways

Inner-loop continuation ≠ inner-loop authority. Можно отдать провайдеру replay истории и всё равно оставить VERIFY, tools и workflow completion на клиенте. Меньше client plumbing не значит меньше token cost.
