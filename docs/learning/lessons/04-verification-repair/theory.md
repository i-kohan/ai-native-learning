# 04 — Verification + bounded Repair — Theory Recap

> Цель: восстановить теорию модуля за 3–5 минут. Практические результаты и traces — в `notes.md`, `traces/` и `docs/learning/experiments.md`.

## Core mental model

Главная идея Module 04:

```text
agent attempt
→ external verification
   ├─ PASS → verified success
   └─ FAIL → factual failure evidence
              → bounded repair
              → verify again
```

**Agent owns the attempt. Verifier owns the evidence. Harness owns the consequence.**

Модель может считать работу законченной, но workflow считается успешным только по правилам harness.

## Verification vs testing

**Testing (тестирование)** — один из способов получить evidence (доказательство/сигнал): `npm test`, integration test, typecheck, schema validation и т.д.

**Verification (проверка результата)** — более широкая задача: собрать нужное evidence и решить, достаточно ли его, чтобы принять outcome.

```text
testing ⊂ verification
```

В нашем V2 verifier пока минимальный: harness независимо запускает `npm test` и принимает `exitCode === 0` как PASS.

## Acceptance criterion, grader, verifier

Полезно различать три роли:

- **acceptance criterion (критерий приёмки)** — что должно быть истинно;
- **grader (конкретная проверка/измеритель)** — как измерить одно свойство;
- **verifier (проверяющая система)** — запускает нужные checks и решает PASS/FAIL по evidence.

Пример:

```text
Acceptance criterion:
GET /tasks/missing → HTTP 404

Grader:
assert.equal(response.status, 404)

Verifier:
run npm test → inspect exit code → PASS / FAIL
```

Терминология в разных системах может отличаться, но operational distinction полезно сохранять.

## Почему self-assessment слабее external evidence

Если та же модель сначала ошиблась в interpretation или implementation, её self-review может повторить ту же ошибку. Это correlated failure (коррелированная ошибка).

Поэтому сигнал:

```text
model: "done"
```

слабее, чем независимый факт environment:

```text
npm test → exit 0
HTTP request → actual status 404
typecheck → no errors
```

External evidence проверяет реальное состояние системы, а не уверенность модели.

## Hierarchy of verification signals

Сила сигнала всегда зависит от конкретного acceptance criterion. Удобная практическая иерархия:

1. direct deterministic acceptance check;
2. deterministic invariant / regression check;
3. observable runtime/API/DB/browser state;
4. compiler / typechecker / linter — сильны только для того свойства, которое реально проверяют;
5. independent LLM judgment;
6. same-agent self-review;
7. agent says "done".

Важно:

```text
deterministic != complete
```

Тест может быть детерминированным, но неполным или неправильным.

## Deterministic verification vs LLM judgment

Если criterion можно хорошо выразить обычным software rule, LLM между environment и PASS/FAIL не нужна.

Хорошо:

```text
actualStatus === 404
→ PASS / FAIL
```

Лишнее:

```text
actualStatus = 404
→ ask LLM "соответствует ли это требованию 404?"
→ PASS / FAIL
```

Правило:

```text
FACT / explicit rule → deterministic software
JUDGMENT / semantic quality → LLM may be useful
```

Например UX-формулировка "сообщение понятно пользователю" может требовать judgment, а exit code, HTTP status, schema или forbidden import — нет.

## Agent-controlled test vs harness-controlled verification

В нашем harness агент всё ещё имеет tool `run_command("npm test")`.

Это полезный inner feedback:

```text
edit → test → observation → fix
```

Но model сама решает, когда его вызвать.

Outer verifier запускается harness независимо:

```text
agent episode stops
→ harness npm test
```

Поэтому:

> **Agent may test. Harness must verify.**

Одинаковая команда выполняет разные роли: development feedback vs completion gate.

## Terminal response != done

`runAgentLoop()` теперь представляет только **episode (эпизод работы агента)**.

```text
no more tool calls
→ terminal response
→ episode stopped
```

Это не означает автоматически:

```text
workflow verified successful
```

Verified completion принадлежит outer harness.

Module 04 при этом **не** строит полный lifecycle state machine. Мы пока не различаем детально `completed / blocked / needs_input / waiting / resume`.

Поэтому остаётся известный limit: если agent завершил episode не потому, что работа реально закончена, а verifier недостаточно полно покрывает acceptance criteria, зелёный verifier всё ещё может дать false success. Богатая stop semantics — отдельная orchestration/lifecycle тема.

## Spec → acceptance → evidence

Spec отвечает:

> Что должно быть истинно?

Verifier отвечает:

> Какое external evidence подтверждает, что это действительно истинно?

Полезная цепочка:

```text
resolved spec
→ acceptance criteria
→ concrete checks / observations
→ verification evidence
→ completion decision
```

Если acceptance criterion ничем не проверяется, зелёный test suite не доказывает этот criterion.

## Raw logs vs normalized failure evidence

Raw test output часто содержит много noise:

- passing tests;
- stack traces;
- npm warnings;
- reporter formatting;
- повторяющиеся строки.

Repair agent полезнее дать компактный factual report.

В V2:

```text
VerificationResult
→ normalizeFailure()
→ NormalizedFailure
```

Он включает, например:

- exit code;
- failed test names;
- locations;
- assertion messages (`500 !== 404`);
- summary counts;
- bounded raw output preview;
- failure signature.

Ключевая граница:

```text
normalizer: WHAT failed
LLM: WHY it failed + HOW to repair
```

Normalizer не должен превращаться в скрытый planner вроде "измени status на 404".

## Normalized vs actionable

**Normalized (нормализованный)** — разные raw failures приведены к общей структуре.

**Actionable (пригодный для действия)** — evidence достаточно конкретно, чтобы следующий reasoning step мог выбрать полезное действие.

Failure report может быть factual и actionable одновременно, не предписывая fix.

## Verify → Repair → Verify

До Module 04:

```text
IMPLEMENT
→ VERIFY
→ FAIL
→ workflow ends
```

V2:

```text
IMPLEMENT episode
→ VERIFY
   ├─ PASS → verified success
   └─ FAIL
       → normalized evidence
       → repair policy
       → REPAIR episode
       → VERIFY again
```

Repair — не просто "повтори raw task". Это новый reasoning episode, conditioned on new evidence (обусловленный новым внешним evidence).

Repair получает:

- resolved authoritative spec;
- current repository state;
- normalized verifier failure;
- existing context hints;
- bounded tools.

Original task остаётся provenance (источником происхождения), но resolved spec — execution authority.

## Bounded retries

Плохой loop:

```text
while (!testsPass) agent.fix()
```

может бесконечно тратить tokens, менять правильный код ради плохого verifier или oscillate (ходить между состояниями).

V2 использует explicit harness policy:

```text
maxRepairAttempts = 2
```

Число 2 — не магическое. Важно само свойство: retry budget ограничен и принадлежит harness.

## Stop conditions и no progress

Repair loop должен остановиться при:

- verifier PASS;
- retry budget exhausted;
- repeated/no-progress failure;
- model/environment error;
- conflict, который нельзя безопасно разрешить автоматическим code repair.

Наш текущий minimal no-progress detector намеренно простой:

```text
same normalized failure signature
+
последний repair не изменил source
→ stop as repeated_failure
```

Он **не** ловит все формы no progress. Например, если agent каждый раз делает бесполезный source change или oscillates `A → B → A`, этот minimal detector может не распознать проблему до исчерпания budget. Более богатая progress analysis пока не нужна.

## Verifier может быть incomplete, wrong или flaky

### Incomplete verifier

Spec требует два behavior, но tests покрывают только один.

```text
covered behavior → PASS
uncovered behavior → broken
```

Получаем false positive.

### Wrong verifier

Spec authoritative:

```text
missing task → 404
```

но test ошибочно требует `200`.

Blind repair может сломать правильную implementation ради зелёного test. При явном spec/verifier conflict автоматический repair должен остановиться / эскалировать, а не "оптимизироваться под grader".

### Flaky verifier

Один и тот же code state:

```text
run #1 PASS
run #2 FAIL
run #3 PASS
```

Repair loop может начать менять правильный код в ответ на случайный signal.

Поэтому verifier — **operational authority для automation**, но не абсолютная истина о продукте.

## Overfitting / test gaming

Agent может сделать verifier зелёным неправильным способом: hardcode expected value, удалить test, изменить grader.

Поэтому capabilities важны не меньше prompt instructions.

В нашем harness repair физически может писать только под:

```text
target-app/src/
```

Tests/spec/verifier находятся вне write boundary. `run_command` также ограничен `npm test`.

Это пример **Tools & Capability Design**: ограничения enforce (принудительно обеспечиваются) кодом harness, а не только просьбой в prompt.

## Когда automatic repair полезен

Хороший случай:

- failure reproducible;
- evidence specific;
- fix plausibly local;
- verification relatively cheap;
- changes reversible / bounded.

Плохой случай:

- verifier flaky или дорогой;
- требуется новое product judgment;
- evidence слишком vague;
- repair требует опасного/необратимого действия;
- scope резко расширяется;
- человек быстрее и надёжнее разрешит конфликт.

Automatic repair — это trade-off: больше model calls/tokens/time и риск overfitting в обмен на шанс автоматически превратить verified FAIL в verified PASS.

## Наш V2

Learning-critical control flow живёт в `run.ts`:

```text
runV1Harness()   # имя осталось историческим
  ↓
implementation = runAgentLoop(... phase="implementation")
  ↓
runVerifyRepairLoop()
  ↓
runFinalVerification()
  ↓ FAIL
normalizeFailure()
  ↓
nextRepairDecision()
  ↓ repair allowed
runAgentLoop(... phase="repair")
  ↓
runFinalVerification()
  ↓ PASS / retry / stop
```

Ownership:

```text
runAgentLoop        = agent episode
runFinalVerification = deterministic evidence
normalizeFailure     = factual compression
nextRepairDecision   = retry/stop policy
runVerifyRepairLoop  = outer lifecycle + completion authority
```

`runV1Harness` — historical naming debt only; actual trace/version and behavior are V2. Renaming it is not learning-critical and was intentionally not used to expand this module.

## R01 controlled repair probe

R01 deliberately does **not** wait for a random model mistake.

Flow:

```text
green fixture
→ normal spec + implementation
→ benchmark-only one-shot fault injection: missing-task 404 → 500
→ external VERIFY #1 FAIL
→ normalize (`returns 404...`, `500 !== 404`)
→ REPAIR #1
→ source write: tasks/task-routes.ts
→ external VERIFY #2 PASS
→ verified success
```

Measured result:

- first external verification: FAIL;
- normalized failure: yes;
- repair attempts: 1;
- repair received resolved spec + failure evidence;
- repair changed only `tasks/task-routes.ts`;
- second external verification: PASS;
- workflow: verified success;
- repeated failure: false.

Controlled fault injection is valid here because the experiment asks:

> "Может ли harness recover после externally observed repairable failure?"

а не:

> "Как часто model сама ошибается?"

## Что R01 не доказывает

R01 не доказывает:

- spontaneous agent failure rate;
- repair success rate на разных реальных дефектах;
- качество verifier coverage;
- отсутствие regressions на T01–T04 (их сознательно не перезапускали в этом experiment);
- устойчивость к flaky/wrong verifier;
- полноценную lifecycle semantics для blocked/needs-input runs.

Для Module 04 этого достаточно: мы изолировали и наблюдали именно новый mechanism `external FAIL → evidence → bounded repair → re-verification`.

Более широкую reliability нужно измерять позже через eval suite, а не раздувать один учебный probe.

## Vocabulary

- **verification** — проверка результата по внешнему evidence;
- **acceptance criterion** — наблюдаемое условие, которое должно быть выполнено;
- **grader** — конкретный check/измеритель одного свойства;
- **verifier** — система, собирающая checks и определяющая PASS/FAIL;
- **failure evidence** — факты о том, что именно не прошло;
- **normalization** — приведение raw failure к компактной общей структуре;
- **repair episode** — отдельная попытка исправления, получившая новое external evidence;
- **bounded retry** — повторная попытка с жёстким лимитом;
- **stop condition** — правило, при котором harness прекращает loop;
- **no progress** — повторные попытки не дают нового полезного результата;
- **fault injection** — контролируемое внесение дефекта для проверки recovery mechanism;
- **operational authority** — источник, по которому automation принимает решение, даже если он не гарантирует абсолютную полноту истины.

## Главная формула модуля

> **Automatic repair имеет смысл, когда каждая новая попытка обусловлена новым external evidence, а harness контролирует verification, capabilities, retry budget и termination.**
