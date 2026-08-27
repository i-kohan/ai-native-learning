# 12 — Planner / Worker / Reviewer

## Core question

Worker уже умеет планировать внутри implementation episode.

Поэтому вопрос модуля не:

> Нужен ли planning?

А:

> Когда implicit planning внутри Worker стоит вынести в отдельный explicit Planner episode?

Отдельный Planner полезен только если выигрыш в decomposition, reliability или execution efficiency компенсирует новый model call, context/handoff overhead, latency и риск stale/anchoring Plan.

Это оптимизация workflow, а не обязательный архитектурный слой.

---

## 1. Spec ≠ Plan

### Spec — WHAT must be true

Spec задаёт authoritative contract:

- какое поведение требуется;
- constraints;
- acceptance criteria;
- что нельзя придумывать самостоятельно;
- какие product ambiguities уже разрешены или требуют human judgment.

Spec отвечает на вопрос:

> **Что должно стать истинным?**

### Plan — HOW we currently intend to get there

Plan — текущая implementation hypothesis:

- какие шаги вероятно нужны;
- в каком порядке;
- какие файлы вероятно релевантны;
- что стоит проверить;
- какие риски видны заранее.

Plan отвечает на вопрос:

> **Как мы сейчас предполагаем прийти к Spec?**

Поэтому Plan имеет меньший authority:

```text
harness / policy constraints
        ↓
resolved Spec
        ↓
repository truth
        ↓
Plan
```

Plan не может:

- добавить новую product semantics;
- изменить Spec;
- расширить permissions/tools;
- превратить `likelyFiles` в edit allowlist;
- заставить Worker игнорировать реальное устройство repository.

Коротко:

> **Spec authorizes WHAT. Plan proposes HOW.**

---

## 2. Planner ≠ Orchestrator

Planner отвечает:

> Как, вероятно, выполнить уже разрешённую задачу?

Orchestrator / outer harness отвечает:

> Можно ли вообще запускать эту фазу и что происходит дальше?

Outer harness по-прежнему владеет:

- workspace / base provenance;
- phase lifecycle;
- tool permissions;
- model routing policy;
- VERIFY;
- repair / review budgets;
- human escalation;
- workflow success/failure;
- eval truth.

Planner может предложить decomposition, но не может сам решить:

```text
"запусти два Worker"
"дай Worker новый tool"
"пропусти VERIFY"
"сделай ещё retry"
```

Даже если Planner это предложит, authority остаётся у harness.

Это продолжение границы из Module 11:

> **Claims belong inward. Authority belongs outward.**

---

## 3. Role ≠ agent instance ≠ parallelism

Planner / Worker / Reviewer — это semantic roles, а не обязательно три автономных агента.

Нужно различать:

- **Role** — responsibility: planning, implementation, review;
- **Agent instance / episode** — конкретный model invocation / loop;
- **Parallelism** — выполняются ли несколько episodes одновременно;
- **Orchestration** — кто управляет lifecycle и переходами между ними.

M12 использует последовательный bounded flow:

```text
resolved Spec
  → [optional] read-only Planner
  → Worker
  → deterministic VERIFY / bounded repair
  → independent Reviewer / bounded review repair
```

Из наличия Planner / Worker / Reviewer не следует:

- parallel workers;
- subagent hierarchy;
- swarm;
- DAG scheduler;
- durable execution engine.

Это отдельные темы следующих модулей.

---

## 4. Worker исполняет Spec, а не Plan

Worker получает resolved Spec отдельно от advisory Plan.

Например Planner предполагает:

```text
likelyFiles = ["src/tasks/task-routes.ts"]
```

Но Worker читает repository и видит, что domain behavior принадлежит `task-service.ts`.

Worker может изменить `task-service.ts` без нового Planner call.

Почему?

Потому что `likelyFiles` — hypothesis, а repository evidence — реальность исполнения.

### Local adaptation

Если отличается локальная implementation detail:

```text
Plan: изменить A
Repo reality: правильно изменить B
```

Worker просто адаптируется.

Это нормальная работа Worker, а не failure Planner.

### Material invalidation

Replan может иметь смысл, если открылась информация, которая ломает уже не отдельный шаг, а всю стратегию, например:

- оказалось, что нужен другой architectural layer;
- появился неизвестный caller/public API;
- требуется compatibility decision;
- исходная decomposition больше не соответствует реальному объёму работы.

Но generic automatic replan loop без evidence создавать не нужно.

Каждый дополнительный planning/replanning layer сам создаёт overhead и новые failure modes.

---

## 5. Reviewer должен быть независим от Plan

Reviewer оценивает то, что реально получилось:

```text
resolved Spec
+ actual diff
+ changed files
+ architecture constraints
+ deterministic VERIFY evidence
```

По умолчанию Reviewer не получает:

- Plan;
- Planner rationale;
- Worker reasoning/conversation.

Причина — **anchoring / correlated error**.

Например:

```text
Planner ошибочно решил, что filtering должен жить в route
        ↓
Worker последовал Plan
        ↓
Reviewer получает тот же Plan
```

Если Reviewer уже видит исходную идею, ему проще принять её framing и пропустить архитектурную ошибку.

Независимый Reviewer должен смотреть на actual artifact относительно authority, а не на историю того, почему implementation получилась такой.

Важно:

> Fresh context ≠ independent context.

Worker после Planner может быть fresh invocation, но он намеренно correlated через Plan. Reviewer мы стараемся оставить fresh **и** independent.

---

## 6. Plan admission помогает, но не делает Plan authority

Planner в M12 read-only:

```text
list_files
read_file
submit_plan
```

У него нет write/run tools.

Structured admission deterministic проверяет то, что действительно можно проверить надёжно:

- schema;
- non-empty steps;
- valid dependency indexes;
- self-dependencies;
- general dependency cycles;
- safe workspace-relative paths.

Но parser не может надёжно deterministic доказать:

> Planner не придумал новую product semantics.

Поэтому semantic safety достигается не «идеальным Plan validator», а архитектурой:

```text
Spec остаётся отдельным authority
+ Plan остаётся advisory
+ Worker видит Spec отдельно
+ VERIFY проверяет executable outcome
+ independent Reviewer проверяет actual diff
```

Не нужен recursive bureaucracy layer вида:

```text
Planner
→ Plan Reviewer
→ Plan Repair
→ Plan Verifier
→ ...
```

без evidence, что такая сложность окупается.

---

## 7. Когда explicit Planner может быть полезен

Отдельный Planner становится интереснее, когда задача достаточно большая, чтобы implicit planning внутри Worker начало создавать execution thrashing.

Например Worker может:

1. начать менять локальный файл;
2. позже обнаружить второй layer;
3. переписать первый change;
4. затем заметить ещё compatibility requirement;
5. сделать лишние reads/writes/repairs.

Upfront decomposition потенциально помогает заранее увидеть:

```text
types
  ↓
service
  ↓
routes
  ↓
verification / compatibility
```

Особенно это может быть полезно для:

- больших multi-file / multi-layer changes;
- long-running implementation;
- handoff между разными workers/people;
- задач, где порядок шагов существенно влияет на wasted work;
- human-reviewable execution plans для дорогих изменений.

В зрелых системах plan часто является first-class artifact именно для сложной работы, тогда как маленькие changes выполняются без отдельной planning ceremony.

Главный принцип:

> **Planning depth should scale with task complexity.**

---

## 8. Когда explicit Planner вреден

Для небольшой задачи strong Worker часто способен:

```text
read
→ understand
→ plan internally
→ implement
```

в одном bounded episode.

Если вынести planning наружу, появляются дополнительные расходы:

- ещё один model invocation;
- повторное чтение repository;
- дополнительные tokens;
- serialization / parsing Plan;
- handoff context;
- latency;
- stale-plan risk;
- anchoring Worker на неудачной decomposition.

Поэтому нельзя оценивать Planner только по локальным Worker metrics.

Например:

```text
Baseline Worker: 5 calls
Variant Worker:  3 calls
Planner:         4 calls
```

Worker стал дешевле, но система стала:

```text
5 → 7 calls
```

Это end-to-end regression.

> **Outcome/system metrics важнее локальных diagnostic metrics.**

---

## 9. Eval discipline для role decomposition

Сравнивать нужно весь workflow.

### Quality / reliability

- expected outcome;
- first VERIFY;
- verification repairs;
- review findings / review repairs;
- irrelevant edits / changed-file scope.

### End-to-end efficiency

- total model calls;
- total tool calls;
- input/output tokens;
- wall time.

### Planning diagnostics

- Planner calls/tools;
- Worker calls/tools;
- planned vs actual files;
- deviations from Plan.

Planning diagnostics помогают объяснить результат, но сами по себе не определяют adoption.

Если quality одинаковая, а Variant дороже end-to-end — Planner нужно отклонить.

Если quality одинаковая и Variant directionally дешевле, но заранее не определено, что считается **meaningful** improvement, нельзя после эксперимента придумать удобный threshold. Такой результат — inconclusive, а не automatic candidate.

---

## 10. P01 result

Controlled probe сравнил:

```text
BASELINE
Spec → Worker

VARIANT
Spec → read-only Planner → advisory Plan → Worker
```

На P01 обе стороны дали одинаковое quality:

```text
expected outcome       3/3 vs 3/3
first VERIFY PASS      3/3 vs 3/3
verification repairs   0 vs 0
review repairs         0 vs 0
```

Но Variant оказался дороже по всем собранным e2e signals:

```text
model calls     8  → 12
 tool calls     23 → 31
input tokens    ~36.6k → ~56.6k
output tokens   ~3.7k  → ~5.3k
wall            ~51s   → ~64s
```

Worker в Variant тоже не стал дешевле.

По predefined rule:

> **Explicit Planner rejected for this feature-sized workload.**

Default остаётся:

```text
Spec → Worker
```

Это не доказывает, что Planner бесполезен на больших задачах.

Это доказывает более узкое и полезное утверждение:

> Для текущего feature-sized workload отдельный Planner не окупил coordination overhead относительно implicit planning strong Worker.

---

## Final mental model

```text
Spec
WHAT must be true
(authority)

Planner
HOW we currently think we should get there
(advisory hypothesis)

Worker
HOW to actually get there given repository reality
(execution + local adaptation)

Reviewer
WHAT is wrong with what was actually produced
(independent judgment)

Orchestrator / harness
WHETHER each phase may run and WHAT happens next
(authority / lifecycle)
```

Короткие правила:

- **Spec > Plan.**
- **Planner proposes; harness authorizes.**
- **Worker may adapt to repo reality.**
- **Reviewer judges the artifact, not the implementation story.**
- **Role decomposition is useful only when its benefit exceeds coordination overhead.**
- **Do not confuse roles with parallel agents.**
- **Do not adopt a Planner because it feels architecturally cleaner — require evidence.**
