# 11 — Modern Model-Native Orchestration / Inner vs Outer Loop

## Главная идея

Современная модель или provider runtime может взять на себя всё больше **временной orchestration внутри одного bounded episode**: continuation reasoning, последовательность tool calls, часть context management, иногда execution нескольких tools или subagents.

Но это не значит, что provider должен владеть **engineering workflow**.

Главная граница Module 11:

```text
OUTER HARNESS
решает: SHOULD / MAY / WHEN / WHAT NEXT / WHAT COUNTS AS SUCCESS

INNER EPISODE
решает: HOW TO EXECUTE THE CURRENT ALLOWED OBJECTIVE
```

Короткая формула:

> **Outer owns whether; inner owns how.**

Ещё одна полезная формула:

> **Claims belong inward. Authority belongs outward.**

Модель может заявить «готово», «нужен repair», «нашёл blocker». Но authoritative transition — запуск VERIFY, разрешение repair, принятие finding, завершение workflow — остаётся у harness.

---

## 1. Inner loop и outer loop

### Inner loop

**Inner loop** — временная reasoning/action orchestration внутри одного semantic episode.

Примеры для implementation:

```text
прочитать router
→ понять, что проблема не там
→ прочитать service
→ сформировать hypothesis
→ посмотреть test
→ изменить file
→ запустить bounded tool
→ решить, нужен ли ещё один read
```

Это state вроде:

- какой файл посмотреть следующим;
- какой hypothesis сейчас наиболее вероятен;
- какие tool results уже видел model;
- какую локальную decomposition использовать;
- достаточно ли evidence для bounded изменения.

Если эта часть state потеряется, модель часто может перечитать несколько файлов и восстановить reasoning. Это может стоить tokens/time, но workflow policy от этого не должна становиться неизвестной.

### Outer loop

**Outer loop** — lifecycle, policy и authoritative state engineering workflow.

В нашем harness сюда относятся:

- task identity;
- semantic phase / episode;
- exact base SHA;
- workspace/worktree;
- tool permissions и security boundaries;
- model routing;
- deterministic verification;
- repair/review attempt counters;
- accepted/rejected review findings;
- human escalation;
- workflow outcome;
- eval truth.

Если такой state потерять, система может сделать запрещённое действие или неправильно решить, что задача завершена.

---

## 2. Responsibility boundary vs control boundary

Эти понятия связаны, но не одинаковы.

### Responsibility boundary

**Responsibility boundary** — кто логически должен принимать решение.

Пример:

```text
repairAttempts = 1/1
```

Harness должен решить, можно ли запускать второй repair.

### Control boundary

**Control boundary** — кто технически способен разрешить или заблокировать действие.

Слабая система:

```text
prompt model:
"не делай больше одного repair"
```

Responsibility вроде бы описана, но control остаётся у модели.

Сильнее:

```text
model может попросить repair
↓
harness nextRepairDecision()
↓
если budget exhausted → repair episode вообще не запускается
```

Другие примеры:

```text
"не пиши вне workspace" в prompt
≠
path enforcement в tool layer
```

```text
"не push main" в prompt
≠
отсутствие credential/tool capability для push main
```

```text
model: "tests passed"
≠
harness реально запустил deterministic VERIFY
```

Для policy/security-critical решений responsibility и control желательно совмещать в outer system.

---

## 3. Physical location ≠ architectural role

Важно не путать:

```text
"код написан у нас"
```

и

```text
"это outer orchestration"
```

До Module 11 `harness/src/loop.ts` физически был нашим TypeScript-кодом, но семантически выполнял inner orchestration:

```text
Responses call
→ inspect function_call
→ local tool
→ append result
→ Responses call
```

`run.ts`, наоборот, держит outer workflow:

```text
implementation
→ VERIFY
→ repair policy
→ REVIEW
→ review repair policy
→ workflow result
```

Поэтому вопрос Module 11 не:

> Можно ли удалить client code?

А:

> Какая responsibility может безопасно уйти inward, не забирая outer authority?

---

## 4. Четыре вида state

Полезно разделять state по durability и authority.

### 4.1 Local reasoning / scratch state

Краткоживущая cognitive работа:

```text
"router выглядит нормально"
"проверю service"
```

Можно потерять и восстановить.

### 4.2 Episode state

State одного bounded model episode:

- response history;
- tool calls/results;
- temporary reasoning continuity;
- response IDs;
- local plan.

Именно сюда попадает `previous_response_id`.

### 4.3 Workflow state

Authoritative state всей задачи:

```text
task = R01
phase = repair
repairAttempts = 1
workspace = wt-123
baseSHA = abc...
last VERIFY = FAIL
```

Это outer state.

### 4.4 Durable workflow state

Workflow state, сохранённый так, чтобы пережить crash/restart/timeouts/process loss.

Module 11 лишь отделяет этот слой концептуально. Полноценная Durable Execution — отдельный будущий модуль.

---

## 5. `previous_response_id`: что реально переносится provider'у

В baseline наш client вручную переносит conversation state:

```text
call #1:
  input = task

response A

call #2:
  input = task + response A output + tool outputs

response B

call #3:
  input = task + A + tool outputs + B + tool outputs
```

При `previous_response_id`:

```text
call #1:
  input = task

response A

call #2:
  previous_response_id = A.id
  input = only new function_call_output

response B

call #3:
  previous_response_id = B.id
  input = only new function_call_output
```

То есть provider начинает владеть **conversation/reasoning continuation transport внутри episode**.

Но он не получает authority над:

```text
repairAttempts
VERIFY
workspace
routing
review policy
workflow status
```

Ключевой distinction:

```text
provider episode state
≠
workflow state
```

Полезный тест архитектуры:

> Если потерять весь provider-side temporary state, можем ли мы всё ещё определить, что workflow разрешено делать следующим?

Если да — boundary обычно здоровая.

---

## 6. Почему response chain заканчивается на checkpoint

Мы сознательно не строим одну цепочку:

```text
spec → implementation → repair → review → review_repair
```

Каждый semantic episode начинает независимый provider chain:

```text
implementation:
A → B → C → STOP

VERIFY  ← outer checkpoint

repair:
D → E → STOP

VERIFY / REVIEW ← outer checkpoint

review_repair:
F → G → STOP
```

Почему это важно:

Repair должен стартовать потому, что outer harness получил deterministic failure и policy разрешила repair, а не потому, что прежняя model conversation «решила продолжить».

Checkpoint возвращает authority outer loop.

---

## 7. Persisted reasoning — cognition optimization, не workflow database

GPT-5.6 умеет сохранять/reuse reasoning items across turns. При `reasoning.context = all_turns` и `previous_response_id` earlier reasoning может быть доступен дальнейшим calls.

Это полезно для continuity:

```text
"router уже исключён"
"главная hypothesis сейчас service transition"
```

Но persisted reasoning не должен быть authoritative storage для:

```text
repairAttempts = 1
workspace = X
human approval = required
review blocker accepted = true
```

Если provider-side reasoning/state недоступен, outer workflow всё равно должен оставаться корректным.

Current OpenAI guidance также говорит: если history управляется вручную, нужно корректно переносить previous user inputs и response output items; `previous_response_id` снимает часть этой protocol responsibility с client.

Source:
- https://developers.openai.com/api/docs/guides/latest-model

---

## 8. `previous_response_id` vs Session vs Conversation

Эти механизмы похожи, но находятся на разных уровнях.

### `previous_response_id`

Самая лёгкая server-managed continuation chain:

```text
A → B(previous=A) → C(previous=B)
```

App хранит последний response ID.

Хорошо подходит для одного bounded episode.

### Session в Agents SDK

Session — SDK-level memory interface.

Runner может:

- загрузить прошлые items до следующего run;
- сохранить новые items после run;
- использовать in-memory, Conversations API или custom storage.

То есть Session не обязательно provider-owned: storage может быть нашим.

### Conversation ID

Отдельная provider-side conversation entity, которую можно продолжать между calls/workers.

Для нашего experiment отдельный Session/Conversation resource был бы более тяжёлым механизмом, чем нужно.

Sources:
- https://openai.github.io/openai-agents-js/guides/sessions/
- https://openai.github.io/openai-agents-js/guides/results/

---

## 9. Provider-managed state ≠ provider-owned orchestration authority

Можно перенести inward разные вещи независимо:

```text
conversation storage        → provider
reasoning continuity        → provider
some tool execution         → provider
some tool sequencing        → provider
```

и всё равно оставить:

```text
workflow legality           → harness
permissions                 → harness
VERIFY                      → harness
retry policy                → harness
human escalation            → harness
workflow result             → harness
```

Поэтому нельзя использовать одну шкалу:

```text
"меньше client code = больше provider orchestration"
```

Есть несколько независимых axes:

1. Кто хранит conversation state?
2. Кто выполняет tool?
3. Кто выбирает tool sequence?
4. Кто управляет workflow transitions?
5. Кто владеет permissions?
6. Кто определяет success?

---

## 10. Custom tools vs hosted tools

### Custom function tools

Наш текущий shape:

```text
model
→ function_call(read_file)
→ OUR HARNESS executeTool()
→ function_call_output
→ model
```

Provider предлагает действие, но client исполняет его.

Это позволяет harness enforce:

- path roots;
- allowed commands;
- workspace binding;
- tracing;
- security policy.

### Hosted tools

Provider может сам выполнять некоторые tools в своём runtime, например hosted shell/code-related capabilities.

Это уже более серьёзная architectural change, потому что меняется не только conversation transport, но и execution environment:

```text
Где exact repo/worktree?
Какая filesystem policy?
Как доставить diff назад?
Как совпадает environment с VERIFY?
Какие network/process permissions?
```

Поэтому Module 11 не переносил наш workspace в hosted shell.

---

## 11. Programmatic Tool Calling (PTC)

GPT-5.6 поддерживает **Programmatic Tool Calling**: model может написать bounded JavaScript-программу, которая вызывает eligible tools, передаёт результаты между calls и обрабатывает intermediate outputs.

Хороший shape:

```text
получить 100 records
→ filter
→ join
→ rank
→ aggregate
→ вернуть 10 records
```

Здесь code может обработать промежуточные данные без нового semantic model judgment после каждого tool result.

Плохой shape для PTC:

```text
read router
→ model решает, куда смотреть дальше
read service
→ model меняет hypothesis
read test
→ model решает, что менять
```

Каждый result меняет следующий semantic decision.

Текущая OpenAI guidance рекомендует direct tool calls, если каждый intermediate result может изменить следующий model decision, а также для approval-sensitive действий.

Поэтому:

> Много tool calls само по себе не означает, что PTC подходит.

Source:
- https://developers.openai.com/api/docs/guides/latest-model

---

## 12. Agents SDK Runner

Agents SDK Runner умеет взять на себя значительную часть generic agent-loop mechanics:

```text
model call
→ inspect outputs
→ execute tools
→ continue
→ terminal result
```

Это может убрать boilerplate нашего `while` loop.

Но важно различать:

```text
SDK owns loop implementation
```

и

```text
provider owns workflow authority
```

Runner — в основном более высокий client SDK abstraction. Он может уменьшить код в repo, но это не автоматически означает, что orchestration переместилась server-side.

Для capstone полная migration на Agents SDK была бы слишком большой переменной: менялись бы framework, tracing/state semantics и loop implementation одновременно.

---

## 13. Tool Search

Tool Search решает другую проблему:

```text
очень большой tool catalog
→ не хочется грузить все schemas в context каждого request
```

Provider/model может находить нужные deferred tools по мере необходимости.

Это похоже на progressive disclosure для Skills:

```text
Skills:
не загружать все procedures

Tool Search:
не загружать все capability schemas
```

У нашего harness четыре маленьких custom tools, поэтому проблемы нет. Добавлять Tool Search сейчас было бы cargo cult.

---

## 14. Compaction

Compaction уменьшает long-running conversation state, когда history становится слишком большой.

Это отвечает на вопрос:

```text
как продолжить длинный model conversation в доступном context budget?
```

Не на вопрос:

```text
что workflow разрешено делать после restart?
```

Поэтому:

```text
compaction
≠
durable workflow state
```

Для коротких bounded episodes capstone compaction пока не нужен.

---

## 15. Background mode vs Durable Execution

### Background mode

Provider может продолжать конкретный model/API job независимо от lifetime текущего HTTP request.

Условно:

```text
queued
→ in_progress
→ completed / failed
```

App потом получает/retrieves этот response.

### Durable Execution

Весь engineering workflow переживает crash/restart:

```text
SPEC done
IMPLEMENTATION done
VERIFY FAIL
repairAttempts = 1
workspace = X
```

Process падает.

После restart outer system загружает authoritative state и знает, что repair #2, например, уже запрещён.

Короткая формула:

```text
background
= one provider job survives request lifetime

durable execution
= whole workflow survives system/process failure
```

Durable state не обязан хранить hidden reasoning или все model turns. Ему прежде всего нужен authoritative workflow state.

---

## 16. Multi-agent [beta] и почему это не Module 11

GPT-5.6 поддерживает native multi-agent beta: один model instance может координировать parallel subagents и синтезировать результаты.

Это хорошо иллюстрирует inner delegation:

```text
OUTER:
"исследуй bounded problem"

INNER:
coordinator
├─ subagent A
├─ subagent B
└─ subagent C
```

Но Module 11 отвечает только на вопрос **где проходит ownership boundary**.

Явная role decomposition и subagent architecture относятся к следующим модулям. Иначе мы бы одновременно меняли boundary и topology системы.

Source:
- https://developers.openai.com/api/docs/guides/latest-model

---

## 17. Наш controlled experiment

### Hypothesis

`previous_response_id` может убрать manual full-history replay внутри `runAgentLoop`, не меняя correctness/security/outer authority.

### Baseline

```text
conversationStateMode = manual
```

Client вручную replay-ит accumulated Responses history.

### Variant

```text
conversationStateMode = previous_response_id
```

Provider continuation используется только внутри отдельного `runAgentLoop` episode.

### Controlled task

T02, `contextMode=variant`, 3 trials per arm, isolated exact-base workspace.

### Results

| Arm | expected | client items avg | client bytes avg | input tokens avg | wall avg |
| --- | ---: | ---: | ---: | ---: | ---: |
| manual | 3/3 | 43 | 53,349 | 17,178 | ~23.6s |
| previous_response_id | 3/3 | 7 | 14,315 | 19,831 | ~32.3s |

Supported conclusions:

```text
correctness preserved on T02      yes
response-id chaining works        yes
client full-history replay gone   yes
custom tools stay client-owned    yes
outer workflow authority intact   yes
client payload reduced            yes
```

Not supported:

```text
token improvement                 not shown
latency improvement               not shown
stable efficiency regression      not proven (n=3)
```

### Decision correction

Первый evaluator post-hoc решил считать regression только при `>1.5x tokens` или `>2x latency`. Эти thresholds не были определены до run.

Поэтому корректная interpretation:

```text
criterion 6 = inconclusive
candidate_to_adopt = no
```

Default остаётся:

```text
manual
```

а `previous_response_id` остаётся реализованным selectable variant.

Это хороший пример eval discipline:

> Нельзя после получения результата придумать threshold, который превращает его в PASS.

Correction provenance:
- `traces/decision-correction-2026-08-26.md`

---

## 18. Почему client bytes упали, а billed tokens — нет

Это один из самых полезных результатов эксперимента.

Мы уменьшили:

```text
what OUR CLIENT serializes and sends explicitly
```

но не обязательно уменьшили:

```text
what MODEL must contextually account for
```

Provider-side continuation всё равно использует previous conversation state. Поэтому:

```text
client payload size
≠
model context size
≠
billed input tokens
```

Сокращение network/protocol plumbing не надо автоматически продавать как token optimization.

---

## 19. Operational observability без hidden chain-of-thought

Нам не нужен private reasoning trace модели.

Нужен operational trace, который отвечает:

```text
какой episode?
какая model?
какой response ID?
какой previous response ID?
какие tools requested?
какие tools реально executed?
какой tool result?
сколько calls/tokens/time?
какой checkpoint/outcome?
```

Для variant trace достаточно видеть:

```text
turn 1: previous=null → resp_A
turn 2: previous=A    → resp_B
turn 3: previous=B    → resp_C
```

и отдельно tool-call/tool-result events.

Hidden reasoning не требуется для debugging responsibility boundaries.

---

## 20. Production-scale mental model

В зрелой системе boundary может выглядеть так:

```text
DURABLE OUTER CONTROL PLANE

workflow state
policy versions
permissions
budget
routing
workspace/provenance
approval state
verification
checkpoint/retry
human escalation
observability/evals

            ↓ bounded objective + authority

INNER EXECUTION / COGNITION PLANE

model reasoning
provider continuation
context management
adaptive tool use
PTC for suitable bounded stages
hosted tools where execution boundary permits
possibly temporary subagents

            ↓ result / evidence

OUTER CHECKPOINT
```

Главный production принцип:

> Push temporary cognition inward; keep durable authority outward.

Это позволяет использовать более мощные provider-native capabilities без превращения provider conversation в единственный источник workflow truth.

---

## 21. Failure modes

1. **Provider state becomes workflow truth.** Потеряли response/session → неизвестно, сколько repairs уже было.
2. **Terminal model message treated as success.** Модель сказала «done», но VERIFY не запускался.
3. **Prompt-only permission boundary.** Model попросили не выходить из workspace, но tool физически позволяет.
4. **One giant response chain across checkpoints.** Repair/review начинают зависеть от старой cognitive history вместо explicit outer contract.
5. **Hosted tool migration silently changes execution environment.** Worktree/security/VERIFY assumptions больше не совпадают.
6. **PTC used because tool count is high.** Хотя каждый result требует нового semantic judgment.
7. **Less code mistaken for less responsibility.** Agents SDK спрятал loop, но authority всё ещё client-owned.
8. **Conversation memory confused with durable state.** Session помнит историю, но не является workflow database автоматически.
9. **Compaction confused with durability.** Context survived; policy state — нет.
10. **Background confused with durable execution.** Response пережил HTTP request; workflow crash recovery — нет.
11. **Provider continuation sold as token optimization without evidence.** Client payload и billed context — разные metrics.
12. **Post-hoc experiment thresholds.** После run придумывается bar, который делает variant победителем.
13. **Over-adoption.** Внедряются PTC/MCP/Tool Search/hosted shell без реального failure mode.
14. **Provider-specific state crosses semantic episode boundaries.** Усложняет recovery, attribution и future provider/model change.

---

## 22. Что должно остаться в голове

1. **Inner vs outer — это прежде всего authority/responsibility, а не место кода.**
2. **Outer owns whether; inner owns how.**
3. Temporary reasoning, tool sequencing и conversation continuation — хорошие кандидаты для inward delegation.
4. VERIFY, retry policy, permissions, workspace, routing policy и workflow outcome — outer responsibilities.
5. `previous_response_id` переносит episode continuation, а не workflow ownership.
6. Response IDs — useful provider state, но не authoritative durable workflow state.
7. Custom function tools остаются client-executed, пока client вызывает `executeTool()` и возвращает `function_call_output`.
8. PTC полезен для predictable data/tool orchestration, но не для каждого adaptive coding loop.
9. Session, conversation, compaction, background и durable execution решают разные проблемы.
10. Provider-native capability стоит внедрять только если она убирает реальную ответственность/сложность и проходит existing outcome/eval bar.
11. Сокращение client payload не означает снижение billed tokens.
12. **No adoption** — нормальный engineering outcome, если evidence не оправдывает permanent change.

---

## Sources / current provider references

Проверено для Module 11 на 2026-08-26:

- GPT-5.6 model guidance — persisted reasoning, `previous_response_id`, Programmatic Tool Calling, multi-agent beta:  
  https://developers.openai.com/api/docs/guides/latest-model
- OpenAI Agents SDK — Sessions:  
  https://openai.github.io/openai-agents-js/guides/sessions/
- OpenAI Agents SDK — Results / server-managed continuation:  
  https://openai.github.io/openai-agents-js/guides/results/

Provider capabilities меняются. Перед production adoption feature availability, semantics и pricing надо перепроверять по текущей официальной документации.
