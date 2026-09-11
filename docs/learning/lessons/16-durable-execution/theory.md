# 16 — Durable Execution

## Главная идея

Durable execution (устойчивое выполнение) — это способность **workflow продолжать существовать независимо от конкретного процесса, который его сейчас исполняет**.

Если Node process умер или закончился, новый process должен уметь определить:

```text
какой это workflow
→ что уже durably завершено
→ какой workspace ему принадлежит
→ какое действие разрешено следующим
```

Это не то же самое, что:

```text
previous_response_id  = continuation model/provider episode
background job        = provider request может жить дольше клиентского HTTP
session / compaction  = сохранение conversation context
trace JSONL           = история/evidence того, что происходило
WorkflowState         = authoritative current state workflow
```

Главный authority остаётся с outer harness.

## Durable semantic facts ≠ durable cognition

Нужно сохранять не мысли модели, а факты о workflow.

```text
cognition:
"похоже, баг в task-service; сейчас проверю complete()"

semantic workflow facts:
workflowId = wf-123
phase = implementation_ready
accepted Spec = ...
workspace/base = ...
```

Cognition можно потерять и получить заново: новый Worker снова прочитает код и заново рассудит.

Потеря semantic facts опасна: новый process может повторить уже завершённую фазу, продолжить не тот workspace или выполнить нелегальный следующий шаг.

Поэтому:

> persist state of work, not thoughts about work.

## Outer state vs inner episode

```text
OUTER HARNESS
owns:
- workflow identity
- current semantic phase
- workspace/provenance
- admitted Spec
- transition policy
- VERIFY / REVIEW authority
- terminal outcome

INNER EPISODE
owns:
- how to execute the currently allowed objective
- local reasoning
- model/tool interaction for that episode
```

Коротко:

> Outer owns whether/what next. Inner owns how.

Durability материализует этот outer state. Она не переносит lifecycle authority в модель.

## WorkflowState ≠ trace ≠ artifact

Эти вещи могут содержать похожие данные, но отвечают на разные вопросы.

```text
WorkflowState:
"что сейчас истинно и что разрешено дальше?"

Trace:
"что происходило до этого?"

Spec/result artifacts:
"какой конкретный продукт/evidence был произведён?"
```

В текущей архитектуре trace JSONL не является event-sourced workflow database. Новый runner не восстанавливает phase, перечитывая trace и угадывая последнее событие.

Он загружает WorkflowState.

Некоторые persisted данные при этом могут быть не authority. Например `specInspectedPaths` можно сохранить как handoff/context optimization; authoritative fact — admitted Spec и phase, а repository map можно recompute.

## Call stack → explicit state machine

До Module 16 semantic phase в основном задавалась положением execution pointer внутри `runV1Harness()`:

```text
если код уже прошёл Spec gate и дошёл до Worker,
значит мы "на implementation"
```

После смерти process эта информация исчезает.

Durable model делает phase explicit:

```text
load WorkflowState
→ inspect phase
→ run one allowed bounded executor
→ harness validates/admit result
→ construct next state
→ durably persist next state
```

Модель не должна иметь authority вроде:

```text
setWorkflowState({ phase: "success" })
```

Даже если JSON schema валидна. Model output — candidate result. Harness решает, допускает ли этот result lifecycle transition.

## Transition admission

Правильная последовательность:

```text
executor produces result
↓
harness validates result and current phase
↓
harness admits legal transition
↓
harness constructs next WorkflowState
↓
store persists it
```

Для первого checkpoint:

```text
spec_required
+ harness-admitted executable Spec
→ implementation_ready
```

Важно различать три события:

```text
1. Spec executor закончил работу
2. Harness признал Spec executable
3. implementation_ready durably persisted
```

Только пункт 3 делает предыдущую semantic phase durably завершённой.

## Checkpoint / commit boundary

Checkpoint (точка фиксации) — это safe semantic boundary, после которой следующий WorkflowState успешно сохранён.

```text
Spec finished
→ admitted executable
→ save implementation_ready
→ durable commit succeeded
```

Если process завершился **до** durable commit:

```text
persisted phase = spec_required
```

Новый process обязан считать именно её authoritative. Spec может быть выполнен повторно.

Если process завершился **после** durable commit:

```text
persisted phase = implementation_ready
```

Новый process обязан пропустить Spec и продолжить с Worker.

Это правило важнее trace: state может быть уже committed, даже если process умер до записи очередного trace event.

## Почему первый checkpoint — после Spec

Выбран boundary:

```text
read/reason phase
Spec
↓
DURABLE CHECKPOINT: implementation_ready
↓
mutating phase
Worker
```

Это хороший первый probe по двум причинам.

### 1. Маленький state

До Worker достаточно сохранить admitted Spec, phase и workspace/provenance. Не нужно переносить repair/review counters и промежуточные mutations.

### 2. До checkpoint ещё нет Worker side effects

Spec phase read-only. Поэтому crash-before-commit может безопасно привести к повторному Spec.

Checkpoint после Worker был бы сложнее:

```text
Worker мог частично изменить workspace
→ process died before acknowledging completion
→ durable state говорит "Worker ещё не закончен"
→ безопасно ли запускать Worker ещё раз поверх этих изменений?
```

Это уже idempotency (безопасность повторного выполнения) и reconciliation (сверка durable state с external side effects). Module 16 это намеренно не решает.

## Реальный WorkflowState Module 16

Текущий file-backed state — discriminated union из трёх semantic phases:

```text
spec_required
implementation_ready
terminal
```

`implementation_ready` содержит:

```text
workflowId
original task
workspace resume evidence
admitted Spec
specInspectedPaths
contextMode
createdAt / updatedAt
schemaVersion
```

`workflowId` — identity всего workflow.

`runId` / invocation ID / PID — identity конкретного запуска process. Один workflow может иметь несколько process invocations.

## Workspace ownership

Resumable workspace принадлежит workflow, а не Node process.

На checkpoint сохраняется evidence:

```text
workspace id/root
baseRevision/ref
HEAD revision
working-tree fingerprint
```

На resume harness:

```text
load expected workspace evidence
→ require existing workspace
→ verify HEAD/base
→ verify persisted source fingerprint
→ bind config to that workspace
→ continue
```

Он не делает:

```text
workspace missing
→ create another worktree from current HEAD
→ continue as if nothing happened
```

Потому что это уже может быть другой execution environment.

В DUR01 fingerprint покрывает `target-app/src`, потому что T02 `setup.patch` меняет source именно там. Это bounded validation boundary probe, не универсальная full-workspace integrity scheme.

## Persistence semantics

WorkflowState хранится локально в JSON.

Write path:

```text
validate state
→ serialize
→ write temp file in same directory/filesystem
→ rename temp → final workflow file
```

Это защищает authoritative JSON от обычного partial overwrite при process crash вокруг записи.

Но здесь нет `fsync`, WAL, replicated database или claim про power-loss durability.

Missing/corrupt/unsupported state → fail closed. Harness не создаёт silently новый workflow.

## Execution flow DUR01

```text
initialize spec_required
→ process A runs Spec
→ harness admits executable Spec
→ persist implementation_ready
→ process A exits
────────────────────────── real process boundary
→ fresh process B loads same workflowId
→ validate existing workspace
→ rebuild recomputable repository context
→ skip Spec
→ Worker
→ VERIFY / bounded repair
→ independent REVIEW / bounded review repair
→ persist terminal outcome
```

`run.ts` не дублирует downstream pipeline: uninterrupted flow и resumed flow используют общий post-Spec executor.

## DUR01 evidence

T02 DEV использован как mechanism probe; holdout не использовался.

Recorded run показал:

- process A и B имели разные PID/invocation ID;
- один и тот же interrupted workflow ID;
- process A завершился на persisted `implementation_ready`;
- process B стартовал с `implementation_ready`;
- в process B `specModelCalls = 0` и был `spec_phase_skipped`;
- тот же workspace/base был reused и validated;
- Worker выполнился;
- VERIFY = PASS;
- independent REVIEW = pass;
- terminal state persisted;
- uninterrupted durable control также завершился success.

Это поддерживает hypothesis для **одного выбранного checkpoint**.

## Failure semantics

Текущий механизм должен fail closed при:

- missing state;
- corrupt JSON/state;
- unsupported schema/phase;
- illegal transition;
- попытке resume terminal workflow;
- missing workspace;
- workspace/base/fingerprint mismatch;
- unsupported experimental durable modes.

Ключевое правило:

```text
work happened but next state was not durably committed
≠
workflow durably completed that phase
```

## Что DUR01 не доказывает

Этот probe не является production durable workflow engine.

Он не доказывает:

- recovery после mid-Worker / mid-VERIFY / mid-REVIEW crash;
- idempotent replay mutating activities;
- concurrent resume, leases или stale-worker fencing;
- distributed ownership;
- arbitrary kill timing внутри state-store write;
- power-loss durability;
- полный fingerprint всех файлов/environment state;
- полное pinning всех config/policy/model inputs across restart;
- crash-safe transaction между terminal state и всеми финальными trace/artifact writes.

Эти ограничения не обесценивают первый checkpoint: они показывают, где начинается следующий слой distributed/durable semantics.

## Когда нужен более тяжёлый механизм

Local JSON достаточно для учебного single-machine probe.

Если появляются:

```text
несколько workers
concurrent ownership
long-running external side effects
retryable activities
leases/timeouts
multi-host recovery
```

тогда нужен более сильный durable store/orchestrator. Не надо заранее строить Temporal-подобную систему ради одного локального checkpoint.

## Takeaways

1. Durable workflow state ≠ conversation/model state.
2. Durable semantic facts ≠ durable cognition.
3. Trace/evidence ≠ current-state authority.
4. Executor proposes result; harness admits transition; store commits it.
5. Checkpoint завершён только после durable commit следующего state.
6. Workflow owns resumable workspace; process — временный executor.
7. Safe first checkpoint лучше ставить перед mutating phase, чтобы не тащить сразу idempotency/reconciliation.
8. Один доказанный checkpoint полезнее, чем преждевременно построенный generic workflow engine.
