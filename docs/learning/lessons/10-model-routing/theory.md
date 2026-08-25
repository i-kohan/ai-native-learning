# 10 — Model Routing

## Главная идея

**Model routing** — это harness-owned решение о том, **какая модель должна выполнить конкретный semantic episode**, при неизменных authority, tools, verification и workflow policy.

Правильный вопрос не:

> Какая модель самая сильная?

А:

> Какая минимально достаточная модель выполняет этот класс работы с требуемым quality / reliability SLO, cost и latency?

Иногда ответ — разные модели для разных эпизодов. Иногда лучший routing policy — одна модель везде.

---

## 1. Model selection vs model routing

### Model selection

Одна модель выбирается для всей системы:

```text
OPENAI_MODEL = Luna
→ spec / implementation / repair / review / review_repair = Luna
```

### Model routing

Модель выбирается для конкретного episode:

```text
semantic episode
      ↓
routing policy
      ↓
selected model
```

Например:

```text
spec            → model A
implementation  → model B
repair          → model C
review          → model D
```

Но наличие нескольких моделей само по себе не является целью.

---

## 2. Routing key, policy и model profile

### Routing key

**Routing key** — сигнал, по которому принимается решение.

Примеры:

- `phase = repair`;
- `taskClass = local_bug`;
- risk class;
- required capabilities;
- context size.

В нашем Module 10 выбран `phase`, потому что это authoritative state harness: harness точно знает, что сейчас выполняется `repair`.

### Routing policy

**Routing policy** — правило выбора:

```text
if episode === repair and repair override exists
→ repair override
else
→ default model
```

### Model profile

**Model profile / capability profile** описывает сам candidate:

- model ID / provider;
- supported tools / function calling;
- context limits;
- quality characteristics;
- price;
- latency / reliability observations;
- snapshot/version provenance, если provider это предоставляет.

Эти три сущности не надо смешивать:

```text
routing key → routing policy → model profile
```

---

## 3. Почему phase routing был хорошим первым шагом

Task-class routing звучит умнее:

```text
simple bug → cheap
cross-layer architecture task → strong
```

Но сначала нужно надёжно классифицировать задачу. Если classifier ошибается, появляется новый failure surface.

У нас `phase` уже детерминирован harness:

```text
implementation
repair
review
review_repair
```

Поэтому первая policy может быть deterministic и легко трассироваться.

---

## 4. Model routing не должен расширять authority

Routing отвечает только на вопрос:

```text
WHICH MODEL?
```

Он не должен решать:

```text
WHICH TOOLS?
WHICH PERMISSIONS?
HOW MANY RETRIES?
IS VERIFY PASS?
IS REVIEW FINDING ACCEPTED?
CAN WE ACCESS SECRETS?
```

Иначе смена модели превращается в скрытую смену privilege level.

Плохой пример:

```text
cheap model  → read-only
strong model → shell + network + secrets
```

Теперь `escalate to strong` одновременно означает `escalate privileges`.

Правильная граница:

```text
repair episode authority = X
Luna repair  → X
Terra repair → X
```

Если episode действительно требует дополнительной capability/authority, это отдельное explicit policy decision.

---

## 5. Capability compatibility прежде economics

Самая дешёвая модель не является candidate, если она не может корректно выполнить workload.

Hard compatibility может включать:

- function/tool calling support;
- required API features;
- context-window fit;
- structured output requirements.

Но есть и **effective capability**:

```text
model formally supports tools
but
→ wrong arguments
→ unnecessary reads
→ many extra turns
→ loops
→ low task success
```

Поэтому routing quality измеряется по реальному workflow, а не только по model spec sheet.

---

## 6. Static, dynamic и model-selected routing

### Static deterministic

```text
repair → Luna
review → Terra
```

Policy известна заранее.

### Dynamic deterministic

Решение зависит от runtime state, но правило остаётся детерминированным:

```text
if context > limit → another eligible model
if provider unavailable → fallback
```

### Model-selected routing

Отдельная модель/classifier сама оценивает workload и выбирает модель.

Это мощнее, но добавляет:

- classifier errors;
- extra latency/cost;
- harder attribution;
- risk, если classifier получает слишком много budget/authority.

Для нашего маленького harness это было бы преждевременно.

---

## 7. Fallback ≠ escalation

### Fallback

Обычно operational причина:

```text
preferred model unavailable / rate-limited / incompatible
→ backup model
```

### Escalation

Capability причина:

```text
cheap bounded attempt failed
→ stronger model
```

Fallback и escalation надо трассировать отдельно. Иначе fallback может скрыть плохую primary policy: система выглядит успешной, хотя основной route почти всегда проваливается.

---

## 8. Почему cheap call ≠ cheap workflow

Допустим:

```text
cheap model
→ repair FAIL
→ stronger repair
→ VERIFY
```

Даже если cheap call стоит в 4 раза меньше, workflow платит за:

- cheap attempt;
- stronger attempt;
- дополнительные tokens;
- дополнительные tool calls;
- latency;
- возможную доработку неправильных изменений cheap model.

Поэтому полезная метрика:

```text
cost per successful workflow
```

а не просто:

```text
$/1M tokens
```

То же относится к latency и model-call count.

---

## 9. Outcome-first evaluation

Routing experiment сначала проверяет качество.

### Quality SLO

**SLO (service-level objective)** — заранее заданный минимальный acceptable outcome.

Его нужно определить **до** просмотра результатов, иначе легко подогнать правило под понравившийся candidate.

Только candidate, прошедший quality SLO, имеет смысл сравнивать по cost/latency.

### Почему eventual success недостаточно

Плохая policy может выглядеть так:

```text
cheap fails often
→ strong model saves it
→ eventualSuccess = true
```

Поэтому нужны:

- first-pass success;
- eventual success;
- verification repairs;
- review repairs;
- retries/escalations;
- calls/tokens/time/cost.

Recovery cost — часть качества routing policy.

---

## 10. Почему review/spec опаснее удешевлять вслепую

У implementation/repair часто есть сильный внешний signal:

```text
model changes code
→ deterministic VERIFY
```

У reviewer проблема сложнее:

```text
reviewer says PASS
```

не доказывает, что он не пропустил defect.

Если grader не покрывает architecture/security issue, weaker reviewer может сохранить `6/6` и одновременно ухудшить реальное качество.

То же касается spec: structured output может быть валидным, но содержать неправильно разрешённую ambiguity.

Поэтому observable quality ≠ total quality.

---

## 11. Наш experiment

Первый routing axis:

```text
phase
```

Первый target:

```text
verification repair
```

Почему repair:

- bounded failure evidence;
- existing R01 controlled probe;
- objective next-step VERIFY;
- failure менее silent, чем в review/spec;
- в предыдущих traces repair был заметным consumer tokens/time.

### Baseline

```text
OPENAI_MODEL=gpt-5.6-luna
OPENAI_REPAIR_MODEL absent
```

### Variant

```text
OPENAI_MODEL=gpt-5.6-luna
OPENAI_REPAIR_MODEL=gpt-5.6-terra
```

Все остальные episodes оставались Luna.

Quality SLO был задан заранее:

```text
3/3 valid R01 trials must satisfy the existing R01 repair contract
```

### Results

| Arm | SLO | repair calls | input/output tokens avg | repair wall avg | workflow wall avg |
| --- | --- | ---: | ---: | ---: | ---: |
| Luna | 3/3 | 4 | 17130 / 1031 | ~12.2s | ~31.2s |
| Terra | 3/3 | 4 | 17254 / 1009 | ~10.5s | ~30.5s |

Quality не разделил модели. Terra была немного быстрее на repair, но end-to-end improvement был небольшим.

На 2026-08-25 официальная text-token pricing для GPT-5.6 Luna — $0.20 input / $1.20 output per 1M tokens, для GPT-5.6 Terra — $2.00 / $12.00, то есть примерно 10× по этим token rates.

Sources:
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/models/gpt-5.6-terra

### Engineering decision

**Permanent `repair → Terra` routing не оправдан текущим evidence.**

Оставляем normal policy:

```text
spec            → Luna
implementation  → Luna
repair          → Luna
review          → Luna
review_repair   → Luna
```

При этом routing boundary остаётся в harness:

```text
resolveModel(episode, config)
```

Он позволяет проверять будущие hypotheses без hardcoded model names по call sites.

Важно: experiment не доказывает, что Luna всегда лучше для repair. Он доказывает только:

> На текущем controlled R01 workload Luna уже удовлетворяет заданному SLO, а Terra не показала достаточного incremental benefit для permanent override.

---

## 12. Routing provenance

Trace должен отвечать не только:

```text
model = Terra
```

но и:

```text
episode = repair
routingReason = repair_override
```

Это **routing provenance** — почему конкретный model invocation получил эту модель.

В больших системах дополнительно полезны:

- policy version;
- provider/model snapshot;
- fallback/escalation reason;
- cost/latency;
- model health;
- experiment/canary cohort.

---

## 13. Drift: routing evidence не вечно

Routing decision может устареть из-за:

- нового model snapshot;
- изменения model quality;
- pricing change;
- context-window change;
- tool compatibility change;
- latency/reliability change.

Поэтому mature systems re-qualify routes, а не считают однажды измеренный выбор вечной истиной.

---

## 14. Как это выглядит на production scale

GitHub Copilot Auto Model Selection — хороший пример mature routing.

GitHub описывает систему, которая сочетает:

- оценку task complexity;
- real-time model health/availability;
- policy/plan eligibility;
- cost/latency considerations;
- routing вдоль natural cache boundaries, чтобы смена модели не уничтожала cache economics без достаточного quality gain.

Source:
- https://docs.github.com/en/copilot/concepts/models/auto-model-selection

Условно:

```text
task requirements
+ eligible models
+ runtime model health
+ cost/latency
+ policy
→ selected model
```

### Почему им это нужно

На большом scale появляются реальные причины:

- много model families/providers;
- provider degradation;
- rate limits;
- разные tenant/admin policies;
- data residency/compliance;
- большой aggregate inference bill;
- миллионы heterogeneous tasks.

### Почему нам это пока не нужно

Наш harness маленький:

```text
5 semantic episodes
1 provider
маленький fixed suite
один tested routing axis
```

Поэтому сейчас health-aware router, task classifier, fallback graph, canary framework и multi-provider abstraction были бы **cargo cult** — complexity без доказанного failure mode.

---

## 15. Когда разные модели по ролям оправданы

Да, mature system может прийти к:

```text
spec           → strong reasoning model
implementation → coding-specialized model
repair         → cheap bounded model
review         → strong review/reasoning model
```

Но роль сама по себе не доказывает необходимость отдельной модели.

Правильная цепочка:

```text
role/workload
→ required capabilities
→ candidate models
→ quality SLO
→ controlled eval
→ cost/latency comparison
→ routing policy
```

**Role specialization — hypothesis. Evals превращают её в policy.**

---

## 16. Типовые routing failure modes

1. Wrong task classification → wrong model.
2. Cheap primary causes extra repairs → workflow becomes more expensive.
3. Model formally supports tools, but uses them poorly.
4. Context does not fit candidate model.
5. Snapshot/model quality drifts after qualification.
6. Pricing changes and old economics become invalid.
7. Latency/reliability becomes unstable.
8. Fallback hides a weak primary route.
9. Tiny benchmark overfits one workload.
10. Repeated experiment trials contaminate fixed eval denominators.
11. Model names get hardcoded across call sites.
12. Router grows into a framework before scale requires it.
13. Model-selected router overuses expensive models.
14. Reviewer/spec quality degrades in ways deterministic graders cannot observe.

---

## 17. Our version vs mature production

| Area | Our Module 10 | Mature production |
| --- | --- | --- |
| Model catalog | default + optional repair override | provider/snapshot/capabilities/context/price/health/compliance catalog |
| Routing key | deterministic phase | task class + capability + risk + budget + health + tenant policy |
| Policy | one explicit repair override | versioned routing policies |
| Evaluation | 3×3 controlled R01 + fixed regression | continuous offline evals, canaries, holdouts, requalification |
| Fallback | none | bounded fallback/escalation chains |
| Observability | episode/model/reason | full policy/snapshot/cost/latency/outcome/fallback provenance |
| Rollout | explicit config | canary/shadow/rollback |

Нам важно понимать правую колонку, но строить её только при появлении соответствующего scale/failure mode.

---

## Итог

Module 10 добавил не «вторую модель», а **явную decision boundary**:

```text
semantic episode
→ harness-owned model resolver
→ selected model
```

Ключевые выводы:

1. Routing выбирает модель, но не authority.
2. Cheapest call не означает cheapest successful workflow.
3. Quality SLO идёт раньше cost/latency.
4. First-pass/recovery metrics нужны, чтобы fallback/repair не скрывали плохую primary policy.
5. Role-specific models возможны, но specialization должна быть доказана eval evidence.
6. Routing provenance нужен для объяснимости и debugging.
7. Model/pricing/snapshot drift требует requalification.
8. `No heterogeneous routing justified` — полноценный инженерный результат.
9. На текущем R01 Luna достаточно; Terra override не оправдан.
10. Routing boundary остаётся как минимальный механизм для будущих evidence-backed hypotheses.
