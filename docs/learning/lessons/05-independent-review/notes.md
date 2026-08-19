# 05 — Independent Review + bounded Review Repair

Практический журнал. V3 reviewer path + REV01 controlled probe прогнаны; Topic Chat review ещё не закрывал модуль. `theory.md` пишет Topic Chat после review.

## Что это за урок одной фразой

После deterministic PASS независимый reviewer с чистым контекстом может поймать architectural defect, который тесты уже приняли; harness, а не модель, решает, что blocker и что чинится ровно один раз.

## Как устроено

```text
SPEC / GATE
→ IMPLEMENT (episode; terminal ≠ verified)
→ [REV01 only] inject completeTask route-owned status/completedAt mutation
→ VERIFY (harness npm test)
   ├─ FAIL → existing V2 bounded repair
   └─ PASS
       → REVIEW #1 (fresh model call; spec + diff + ARCH constraints + compact verify evidence)
          ├─ no accepted blocker → success
          └─ accepted blocker
              → review repair #1 (application source only)
              → VERIFY again (existing V2 policy)
              → REVIEW #2
                 ├─ no accepted blocker → success
                 └─ accepted blocker → stop; no repair #2
```

Команды:

- `cd harness && npm test` — механические тесты без модели
- `cd harness && npm run benchmark:rev01` — контролируемый independent-review probe
- T01–T04 / `benchmark:experiment` в этом модуле **не** гонялись
- reviewer OFF/ON baseline **нет** — только V3 path

Локальный прогон: `traces/REV01-review-*.jsonl` (gitignore).  
Evidence: `docs/learning/lessons/05-independent-review/traces/`.

## Границы, которые нельзя смешивать

1. **Verifier** остаётся authority для deterministic checks; reviewer не заменяет тесты.
2. **Reviewer context** — только spec, diff, architecture constraints, compact verify evidence. Нет implementer conversation/justification.
3. **Finding acceptance** принадлежит harness: accepted blocking / accepted non-blocking / rejected+reason.
4. **Max review repair = 1.** REVIEW #2 никогда не запускает repair #2.
5. Review repair пишет только `target-app/src/`.
6. Fault injection живёт только в REV01 (`rev01-fault.ts` + `afterImplementationEpisode`).

## Политика, которая вылезла на первом прогоне

Первый REV01 поймал ARCH-01 **и** второй finding той же проблемы как `correctness` / spec_requirement. Harness принял его как второй blocker → `blocking_fp=1` → decision rule UNEXPECTED.

После этого correctness finding при уже PASS verification записывается как non-blocking (`verifier_authoritative`). Это не semantic dedup: это явное правило «reviewer не заменяет тесты».

## REV01 — что доказали / что нет

Доказали на одном контролируемом дефекте (финальный прогон `REV01-review-2026-08-19T15-34-43-433Z`):

```text
controlled ARCH-01 injection
→ first npm test PASS
→ REVIEW #1: architecture + ARCH-01 + concrete completeTask/task-routes evidence
→ harness accepted exactly one blocker
→ review repair #1 changed tasks/task-routes.ts only
→ npm test PASS
→ REVIEW #2: no accepted blocker
→ workflow success
```

Не доказали: spontaneous architecture misses, регресс T01–T04, ценность reviewer без заранее данного ARCH-01, устойчивость findingKey между прогонами.

## Файлы, которые стоит лично просмотреть

1. `harness/src/review.ts` — parse, acceptance policy, `nextReviewDecision`, ReviewContext
2. `harness/src/run.ts` — `runIndependentReviewLoop` после VERIFY PASS
3. `harness/src/review-phase.ts` — fresh reviewer invocation, только `submit_review`
4. `harness/src/rev01-fault.ts` + `run-benchmark.ts` `runReviewProbe` — одноразовый controlled defect
5. `harness/tests/review.test.ts` — policy boundaries без модели

## Наблюдения с REV01 (2026-08-19)

Финальный expected run:

- Implementation на зелёном fixture ничего не менял; injection нарушил ARCH-01, тесты остались зелёными.
- REVIEW #1 findingKey: `ARCH-01-route-mutates-task-state`; evidence: `service.get(id)` + прямые `task.status` / `task.completedAt`; relatedAuthority ARCH-01.
- reviewAttempts=2; reviewRepairAttempts=1; blocking_fp=0; repeatedFinding=false
- review repair: 4 model / 5 tools; write только `tasks/task-routes.ts`
- Tokens: review 3409/287; review_repair 11623/1008; total 26367/2473
- Wall ~36s
- Финальный workflow diff пустой — ожидаемо: injection откатили к fixture.

Первый прогон (`REV01-review-2026-08-19T15-31-34-772Z`): intended detected, но correctness restatement стал вторым blocker.

## Open questions для Topic Chat

- Достаточно ли V3 на одном REV01, или нужен natural architecture miss без injection?
- Оставлять ли `verifier_authoritative` как постоянное правило для correctness после PASS?
- Нужно ли нормализовать findingKey, если один и тот же дефект называется по-разному между прогонами?
