# 06 — Tracing & Evals

## Идея модуля

Tracing и evals отвечают на **разные вопросы**.

- **Trace (трасса)**: что произошло в одном конкретном run?
- **Eval (оценка)**: насколько хорошо система ведёт себя на наборе задач/runs?

Поэтому raw logs сами по себе ещё не eval.

Минимальный measurement pipeline:

```text
raw trace / HarnessRunResult
→ normalize semantics
→ RunMetrics
→ aggregate many runs
→ EvalResult
→ engineering decision
```

Главный принцип:

> **Trace records behavior. Eval interprets behavior against an explicit benchmark contract.**

---

## Trace, log, event, span, episode

### Log vs trace

**Log** — отдельное сообщение/факт.

**Trace** — связанная история одного execution run, из которой можно восстановить lifecycle.

JSONL может содержать и logs, и trace events. Разница не в формате файла, а в correlation и структуре.

### Event / span / episode

Полезная иерархия:

```text
run
→ episode / phase
→ span / operation
→ event
```

Примеры:

- event: `verification_failed`, `finding_accepted`;
- span: один model call или verification attempt с duration;
- episode: implementation, repair, review;
- run: полный task lifecycle до terminal outcome.

OpenTelemetry для этого не обязателен. В Module 06 достаточно текущих JSONL traces + structured run result.

---

## Observability vs debugging

**Debugging** — расследовать конкретный incident.

**Observability (наблюдаемость)** — система заранее показывает достаточно structured state, чтобы понимать:

- где падают задачи;
- где тратятся calls/tokens/time;
- насколько часто нужен repair;
- где reviewer создаёт blockers;
- какие findings повторяются.

Хорошая observability не означает «логировать всё».

Правило:

> Если поле не отвечает на инженерный вопрос, его не нужно автоматически тащить в eval schema.

Большие raw outputs, full prompts, repo dumps и model prose могут быть полезны для debugging, но не должны без причины становиться core metrics.

---

## Raw trace → normalized RunMetrics

Raw instrumentation часто имеет implementation quirks и меняющуюся schema.

Module 06 вводит normalization boundary:

```text
HarnessRunResult
→ normalizeRun(...)
→ RunMetrics
```

`RunMetrics` — компактная semantic representation одного run, которую уже безопаснее сравнивать и агрегировать.

Примеры normalization:

- canonical `taskId` вместо raw task text;
- `runId` как отдельная identity;
- `taskKind` разделяет capability tasks и mechanism probes;
- verification count берётся по actual execution sequence, а не по локальным raw attempt numbers;
- T04 получает `firstPassSuccess=null`, а не ложный `false`;
- reviewer accepted finding не превращается автоматически в true/false positive.

Идея:

> Raw trace говорит, **что физически записалось**. RunMetrics говорит, **как мы договорились это семантически интерпретировать**.

---

## Три уровня истины

Полезно разделять:

```text
1. TRACE FACT
2. NORMALIZED RUN SEMANTICS
3. BENCHMARK JUDGMENT
```

Пример T04:

```text
TRACE:
workflowStatus = needs_human_judgment
implementationStarted = false

RUN METRICS:
humanEscalation = true
autonomousCompletion = false
firstPassSuccess = null

BENCHMARK:
expectedOutcomeMet = true
```

То есть trace не знает, хороший ли outcome. Это знает benchmark contract.

---

## Tests, graders, metrics, evals

### Test

Проверяет конкретное свойство.

Например:

```text
GET /tasks/:id missing → 404
```

### Grader

Механизм, который решает, выполнено ли ожидаемое свойство/task contract.

Grader может быть:

- deterministic test;
- linter/typecheck;
- external benchmark check;
- иногда LLM judgment.

### Metric

Число/поле, извлечённое из run evidence.

Например:

- `modelCalls`;
- `verificationRepairAttempts`;
- `firstPassSuccess`;
- `expectedOutcomeMet`.

### Eval

Систематическая оценка поведения harness на fixed suite или множестве runs.

```text
fixed tasks
→ run
→ grade
→ normalize
→ aggregate
→ compare / decide
```

---

## Outcome metrics vs diagnostic metrics

Это одно из главных различий Module 06.

### Outcome metrics

Отвечают: **правильно ли система выполнила задачу/contract?**

Примеры:

- `expectedOutcomeMet`;
- `eventualSuccess`;
- correct escalation;
- escaped defect, если есть независимый grader.

### Diagnostic metrics

Отвечают: **как система пришла к outcome и сколько это стоило?**

Примеры:

- model/tool calls;
- tokens;
- wall time;
- verification/review attempts;
- repair count;
- rejected findings.

Диагностическая метрика сама по себе не является целью.

Например:

```text
toolCalls ↓
```

не обязательно хорошо: harness мог просто перестать проверять нужные вещи.

Приоритет:

```text
correct outcome
> recovery/robustness
> efficiency diagnostics
```

---

## `expectedOutcomeMet` ≠ `workflowStatus === success`

Главная benchmark metric Module 06:

```text
expectedOutcomeMet
```

Она означает:

> Выполнился ли ожидаемый contract именно этой benchmark task?

T01–T03:

```text
workflow success
+ executable spec
+ implementation happened
+ verification PASS
→ expectedOutcomeMet = true
```

T04:

```text
needs_human_judgment
+ implementation did not start
+ no source changes
+ unresolved ambiguity remains
→ expectedOutcomeMet = true
```

То есть правильная escalation — хороший outcome, хотя задача не была autonomously completed.

---

## First-pass vs eventual success

### First-pass success

Для executable completion task:

> Task достигла accepted final success без harness-level recovery.

Harness-level recovery:

- verification repair;
- review repair;
- human escalation.

Внутренние model/tool iterations внутри initial implementation episode не считаются отдельным recovery.

Пример:

```text
IMPLEMENT
→ VERIFY PASS
→ REVIEW PASS

firstPassSuccess = true
eventualSuccess = true
recoveredSuccess = false
```

### Recovered / eventual success

```text
IMPLEMENT
→ VERIFY FAIL
→ repair
→ VERIFY PASS
→ REVIEW PASS
```

даёт:

```text
firstPassSuccess = false
eventualSuccess = true
recoveredSuccess = true
```

REV01 тоже recovered success:

```text
VERIFY PASS
→ REVIEW blocker
→ review repair
→ VERIFY PASS
→ REVIEW PASS
```

Важно: `firstVerificationPassed=true` и `firstPassSuccess=false` могут одновременно быть верны.

### N/A вместо false

Для T04 first-pass/eventual/recovered = `null`.

Причина не в том, что T04 «плохая задача», а в том, что implementation **не должна стартовать**. Вопрос first-pass implementation success здесь неприменим.

---

## Autonomous completion и human escalation

Эти metrics описывают другой axis.

T04:

```text
expectedOutcomeMet = true
autonomousCompletion = false
humanEscalation = true
```

Это корректное состояние.

Поэтому нельзя оптимизировать autonomy в отрыве от correctness.

Harness, который никогда не спрашивает человека и всегда угадывает product semantics, может иметь высокий autonomy rate и быть плохой системой.

---

## Representative suite vs controlled mechanism probes

Module 06 сознательно разделяет две группы.

### Capability / regression

```text
T01
T02
T03
T04
```

Они отвечают:

> Как V3 ведёт себя на обычных типах задач?

### Mechanism probes

```text
R01   → verification repair
REV01 → independent review repair
```

Они отвечают:

> Срабатывает ли конкретный механизм при специально созданном trigger?

Probe — не «необъективный тест». Он объективен относительно **другого вопроса**.

R01 специально создаёт initial VERIFY FAIL. Поэтому нельзя включать R01 в natural first-pass rate.

REV01 специально injects reviewer-detectable ARCH-01 defect. Поэтому нельзя использовать его как natural reviewer defect-rate evidence.

Правило:

> Не смешивать metrics, если у runs разные data-generating conditions и разные semantics.

---

## Denominator — часть смысла метрики

Например capability suite:

```text
T01–T04 expected outcome = 4 / 4
```

Но first-pass:

```text
T01–T03 only
3 / 3
```

T04 не входит в denominator, потому что first-pass completion к ней неприменим.

R01/REV01 тоже не входят, потому что recovery там создан намеренно.

Неверный denominator может сделать полностью корректный код измерения статистически бессмысленным.

---

## Reviewer metrics и ground truth

Reviewer output — probabilistic judgment.

Можно объективно считать factual workflow data:

```text
findingsObserved
acceptedBlocking
acceptedNonBlocking
rejected
repeatedFinding
```

Но нельзя автоматически выводить:

```text
acceptedBlocking → true positive
rejected → false positive
```

Почему:

- accepted — решение harness policy, не ground truth;
- rejected finding может быть реальным, но out-of-scope;
- false positive требует независимого знания, что defect на самом деле отсутствует.

В REV01 есть controlled ground truth: мы сами inject конкретный ARCH-01 defect. Поэтому probe-specific `intendedFindingDetected` имеет сильную семантику.

Generic reviewer precision/recall пока не измеряются.

---

## Escaped defect

**Escaped defect**:

> Harness говорит success, но независимый benchmark grader знает, что requirement всё ещё нарушен.

```text
internal VERIFY/REVIEW = green
external benchmark grader = FAIL
→ escapedDefect = true
```

В текущем suite grader использует тот же `npm test`, что и harness VERIFY.

Поэтому независимого ground truth нет и:

```text
escapedDefect = null
```

а не `false`.

`false` означало бы, что мы реально независимо проверили отсутствие escaped defect.

---

## Failure reason ≠ root cause

Workflow может остановиться с factual reason:

```text
final_verification_failed
spec_phase_failed
review_parse_failed
```

Но это ещё не говорит, **почему система сломалась**.

Root-cause taxonomy может включать:

- MODEL;
- SPEC;
- CONTEXT;
- TOOL;
- ENVIRONMENT;
- POLICY;
- VERIFIER;
- REVIEWER;
- ORCHESTRATION;
- RESOURCE.

Например VERIFY FAIL может означать, что verifier правильно поймал ошибку implementation — тогда root cause скорее MODEL/implementation, а не VERIFIER.

Поэтому Module 06 не выдумывает automatic root-cause classifier: `failureLayer=null`, если evidence недостаточно.

---

## Recurring findings

Structured findings позволяют агрегировать reviewer patterns между runs.

Минимально:

```text
(findingKey, category)
→ observed
→ acceptedBlocking
→ acceptedNonBlocking
→ rejected
→ repeatedAfterRepair
```

Recurring finding — только **candidate signal**.

Нельзя автоматически делать:

```text
observed many times
→ deterministic rule
```

Правильная эволюция:

```text
recurring finding
→ human validates pattern
→ stable/context-independent invariant?
→ deterministic test/linter/check
```

Это переносит устойчивое правило из probabilistic reviewer layer в более дешёвый и воспроизводимый deterministic layer.

---

## Fixed suite и regression

Для regression comparison нужны стабильные:

```text
tasks
+ starting fixtures
+ graders
+ metric semantics
```

**Regression** в текущем модуле:

> То, что раньше fixed benchmark contract выполнялось, а после harness change перестало выполняться.

Hard regressions:

- T01–T03 expected outcome fails;
- T04 перестаёт правильно эскалировать;
- R01 mechanism contract fails;
- REV01 mechanism contract fails;
- known escaped defect появляется при наличии independent grader.

Diagnostic changes не являются автоматически hard regression:

- tokens выросли;
- calls выросли;
- задача потребовала bounded repair;
- reviewer дал больше rejected findings.

Сначала сохраняем correctness, затем разбираемся с efficiency/reliability diagnostics.

---

## R01 и REV01 — что именно они доказывают

### R01

Expected mechanism contract:

```text
controlled fault
→ VERIFY FAIL
→ exactly one verification repair
→ VERIFY PASS
→ workflow success
```

Это доказывает repair path для конкретного controlled failure, а не natural repair frequency.

### REV01

Expected mechanism contract:

```text
controlled ARCH-01 defect
→ VERIFY PASS
→ REVIEW #1 catches intended blocker
→ exactly one review repair
→ VERIFY PASS
→ REVIEW #2 PASS
→ workflow success
```

Важно: probe требует именно `PASS → PASS` на deterministic verification и **zero verification repairs**.

Сценарий:

```text
review repair
→ VERIFY FAIL
→ verification repair
→ PASS
```

не считается успешным independent-review-repair probe, потому что review repair сам не восстановил корректное verified state.

---

## Что текущий Module 06 не доказывает

Fixed suite 6/6 не означает:

- «100% task success rate» в реальном мире;
- broad reviewer precision;
- general defect detection rate;
- escaped-defect safety;
- production-scale benchmark quality;
- статистическую стабильность на stochastic repeated trials;
- правильность всех будущих task distributions.

Один successful controlled probe доказывает механизм на этом trigger, а не общую performance системы.

---

## Что запомнить

1. **Trace = что произошло в одном run; eval = насколько хорошо система работает по benchmark contract.**
2. Raw trace лучше нормализовать в стабильный `RunMetrics`, а уже потом агрегировать.
3. `workflow success` и `expectedOutcomeMet` — разные понятия.
4. Outcome metrics важнее diagnostic metrics.
5. First-pass и eventual success нельзя смешивать; recovery должен быть виден.
6. Correct human escalation может быть успешным benchmark outcome.
7. Representative tasks и controlled probes должны иметь разные denominators/interpretation.
8. Accepted/rejected reviewer finding не является автоматически true/false positive — нужен ground truth.
9. Если independent ground truth отсутствует, metric должна быть `unknown/N/A`, а не придуманным `false`.
10. Fixed suite + stable semantics дают regression signal; 6/6 contracts не превращаются автоматически в универсальный performance claim.
11. Recurring validated reviewer findings — кандидаты на promotion в deterministic checks, не автоматические правила.
12. Хороший eval layer помогает не только считать цифры, а принимать инженерное решение: **keep / investigate / reject change**.
