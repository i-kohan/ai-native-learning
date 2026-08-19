# 05 — Independent Review → Repair

## Идея модуля

Deterministic verification и independent review отвечают на **разные вопросы**.

- **Verifier (верификатор)**: прошли ли заранее закодированные проверки?
- **Reviewer (независимый ревьюер)**: остались ли в уже verified change важные инженерные проблемы, которые эти проверки не покрывают?

Поэтому `npm test = PASS` не означает «изменение вообще корректно». Это означает только: **properties, которые проверяют текущие graders/tests, прошли**.

V3 добавляет после deterministic PASS отдельный semantic/judgment layer:

```text
SPEC
→ IMPLEMENT
→ VERIFY / bounded repair
→ deterministic PASS
→ independent REVIEW
→ harness finding policy
→ optional bounded review repair
→ VERIFY again
→ final REVIEW
```

Главный принцип:

> **Verifier owns deterministic evidence. Reviewer owns independent judgment + grounded findings. Harness owns the consequence.**

Reviewer не получает право сам решать lifecycle и не заменяет verifier.

---

## Verifier vs Reviewer

### Deterministic verifier

Хорош для свойств, которые можно формально проверить:

- тесты проходят;
- endpoint возвращает 404;
- schema валидна;
- import запрещён;
- lint/typecheck проходит.

Его сильные стороны: воспроизводимость, низкая стоимость, понятный PASS/FAIL.

### LLM reviewer

Нужен там, где важное свойство пока трудно или невыгодно формализовать:

- архитектурная граница нарушена;
- diff создаёт дублирующий путь изменения state;
- изменение выходит за scope;
- есть maintainability/compatibility risk;
- есть uncovered correctness problem, которую текущие tests не кодируют.

Важно: deterministic PASS **не запрещает** correctness finding. Он запрещает reviewer без нового evidence просто спорить с уже доказанным конкретным check.

---

## Почему reviewer должен быть independent

**Independent (независимый)** здесь не обязательно означает другую модель.

Минимально достаточно:

1. **отдельного model invocation / fresh context**;
2. другой роли: implementer строит решение, reviewer ищет проблемы;
3. reviewer оценивает **artifacts**, а не объяснения implementer.

Implementer уже привязан к своей гипотезе решения. Если self-review продолжает ту же conversation history, модель может сохранить тот же framing и те же blind spots.

Поэтому reviewer по умолчанию **не получает**:

- implementer reasoning;
- implementation conversation;
- justification «почему решение хорошее»;
- failed approaches;
- огромный raw trace.

Это уменьшает anchoring и correlated errors — ситуации, когда implementer и reviewer ошибаются одинаково из-за общего reasoning trajectory.

---

## ReviewContext

Минимальный purpose-built context V3:

```text
resolved spec
+ current/final diff
+ authoritative architecture constraints
+ compact deterministic verification evidence
```

Роли этих частей:

- **resolved spec** — что должно быть сделано;
- **diff** — что реально изменилось;
- **architecture constraints** — какие дополнительные инженерные правила обязательны;
- **verification evidence** — что deterministic layer уже доказал.

Reviewer не должен придумывать новые product semantics или architecture rules. Если правило важно для review, оно должно быть grounded в spec/constraint/repository evidence.

---

## Finding, а не opinion

**Finding (замечание с основанием)** должен быть actionable и grounded.

Плохо:

> «Я бы вынес это в helper; так чище».

Это preference/opinion.

Хорошо:

> `completeTask()` в `task-routes.ts` теперь напрямую меняет `task.status` и `task.completedAt`, хотя `ARCH-01` требует, чтобы state transitions принадлежали `TaskService`.

Полезный finding отвечает на:

- **WHAT** — что не так;
- **WHERE / evidence** — где это видно;
- **WHY** — почему это важно;
- **AUTHORITY** — с каким spec requirement/constraint связано.

Минимальная V3 schema:

```text
ReviewResult
  status: pass | findings

Finding
  findingKey
  category
  severity
  confidence
  description
  evidence[]
  relatedAuthority?
```

### Severity / confidence / blocking — разные вещи

- **severity** — насколько серьёзна проблема, если finding верен;
- **confidence** — насколько reviewer уверен, что finding действительно подтверждён evidence;
- **blocking** — решение harness policy: можно ли принять workflow без исправления.

Reviewer может предложить `severity=high`, но это ещё не значит автоматически запускать repair.

---

## Finding acceptance policy

Между probabilistic reviewer output и source mutation обязательно стоит harness policy:

```text
LLM finding
→ validate / classify
→ accepted blocking | accepted non-blocking | rejected
→ harness consequence
```

Минимальная policy V3 проверяет:

- есть ли concrete evidence;
- finding in scope;
- не ссылается ли он на несуществующую authority;
- actionable ли он;
- confidence достаточен ли;
- severity достаточна ли для blocker.

Low-confidence / low-severity findings можно сохранить, но не чинить автоматически.

**Accepted ≠ objectively true.** Это значит только: finding достаточно grounded и важен, чтобы policy разрешила workflow consequence.

---

## False positives и reviewer overreach

LLM reviewer вероятностный, поэтому может:

- неверно прочитать control flow;
- не заметить существующий invariant;
- придумать architecture rule;
- повторить уже доказанную tests проблему без нового evidence;
- предложить redesign вне scope;
- продублировать один defect несколькими категориями.

False positive особенно опасен в autonomous harness:

```text
ложный blocker
→ automatic repair
→ ненужное изменение правильного кода
```

Поэтому нельзя делать `findings.length > 0 → repair`.

Первый REV01 показал реальный пример: один ARCH-01 defect был найден как architecture finding и дополнительно пересказан как correctness finding. Это полезный evidence duplicate/misclassified output. Правильный вывод — улучшать grounding/policy, **а не отключать весь класс correctness findings после PASS**.

---

## Bounded Review → Repair lifecycle

V3 специально не строит бесконечный reviewer loop.

```text
VERIFY PASS
→ REVIEW #1
   ├─ no accepted blocker → success
   └─ accepted blocker
       → review repair #1
       → deterministic VERIFY / existing bounded repair
       ├─ cannot reach PASS → failure
       └─ PASS
           → REVIEW #2
              ├─ no accepted blocker → success
              └─ accepted blocker → stop
```

Policy:

- `maxReviewRepairAttempts = 1`;
- REVIEW #2 никогда не запускает repair #2;
- repeated blocker после repair = no-progress evidence;
- новый blocker после repair тоже останавливает workflow: bounded loop не converged;
- non-blocking findings записываются без automatic mutation.

После любого review repair deterministic verification обязательна, потому что предыдущий PASS относился к **предыдущему code state**.

---

## Когда LLM reviewer не нужен

Не стоит платить за probabilistic judgment, если свойство легко formalize.

Например, если известно правило:

> `routes/` не может импортировать `storage/`.

лучше architecture test/linter, а не LLM вопрос на каждой задаче.

Есть два пути к deterministic check:

1. **Rule already known** → сразу кодируем deterministic invariant.
2. **Reviewer repeatedly finds the same real defect class** → человек подтверждает, что это устойчивое правило → **promote recurring finding into a deterministic check**.

Это важная эволюция harness:

```text
semantic discovery by reviewer
→ recurring validated pattern
→ explicit invariant
→ deterministic grader/linter/test
```

Поэтому structured findings полезно сохранять: позже tracing/evals может показать recurring `findingKey/category`, confirmed findings и false positives. Сам aggregation/memory слой в Module 05 не строился.

---

## REV01 — практическое доказательство

Controlled defect:

- `completeTask()` в route перестаёт делегировать `TaskService.complete()`;
- route сам меняет `status` и `completedAt`;
- observable behavior остаётся корректным;
- `npm test` остаётся зелёным;
- explicit `ARCH-01` запрещает state transitions в route layer.

Corrected-policy run:

```text
controlled ARCH-01 injection
→ deterministic VERIFY PASS
→ REVIEW #1: 1 architecture blocker with concrete evidence + ARCH-01
→ review repair #1: tasks/task-routes.ts only
→ deterministic VERIFY PASS
→ REVIEW #2: pass
→ workflow success
```

Observed:

- reviewAttempts = 2;
- reviewRepairAttempts = 1;
- blockingFalsePositives = 0;
- repeatedFinding = false;
- finalReviewerOutcome = pass.

Это доказывает **механизм**: independent reviewer может поймать важное engineering violation после deterministic PASS и через bounded repair предотвратить принятие этого controlled defect.

Не доказано:

- broad reviewer quality на реальных задачах;
- natural defect detection rate;
- общий false-positive rate;
- ценность reviewer без explicit architecture constraints;
- стабильность `findingKey` между разными формулировками;
- что любой recurring finding надо оставлять LLM reviewer навсегда.

---

## Что запомнить

1. **Verification ≠ review.** Verifier проверяет encoded properties; reviewer ищет важные uncoded problems.
2. Independent reviewer — fresh, purpose-built context, а не self-review implementer history.
3. Reviewer получает artifacts/evidence, а не implementer justification.
4. Finding должен быть grounded: что, где, почему, authority.
5. Reviewer output не имеет прямого пути к write — consequence принадлежит harness policy.
6. Reviewer probabilistic: false positives, overreach и duplicate findings ожидаемы.
7. Review repair bounded; после него обязательна deterministic re-verification и final re-review.
8. Повторяющиеся подтверждённые reviewer rules стоит по возможности переносить в deterministic checks.
