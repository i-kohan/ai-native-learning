# 05 — Independent Review + bounded Review Repair

Практический журнал. V3 reviewer path + REV01 controlled probe прогнаны; Topic Chat review завершён. Модуль готов к формальному закрытию Master.

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

1. **Verifier** is authoritative only for the checks it actually encodes. Reviewer findings must not merely contradict passed deterministic evidence without new evidence; they may still identify uncovered correctness problems.
2. **Reviewer context** — только spec, diff, architecture constraints, compact verify evidence. Нет implementer conversation/justification. Architecture/layering не пересказывать как correctness/spec.
3. **Finding acceptance** принадлежит harness: accepted blocking / accepted non-blocking / rejected+reason.
4. **Max review repair = 1.** REVIEW #2 никогда не запускает repair #2.
5. Review repair пишет только `target-app/src/`. Review-repair `model_error` fails the workflow; it is not stripped before re-verify.
6. Fault injection живёт только в REV01 (`rev01-fault.ts` + `afterImplementationEpisode`).

## Первый прогон — duplicate/misclassified output

Первый REV01 (`REV01-review-2026-08-19T15-31-34-772Z`) поймал ARCH-01 **и** второй finding той же проблемы как `correctness` / spec_requirement. Harness принял его как второй blocker → `blocking_fp=1` → decision rule UNEXPECTED.

Это полезный evidence: reviewer может продублировать один слой двумя категориями. Это **не** основание demote-ить все correctness findings после PASS. Uncovered correctness с concrete evidence всё ещё может быть blocking. Architecture/layering по инструкции reviewer не должен пересказывать как spec/correctness.

## REV01 — что доказали / что нет

Доказали на одном контролируемом дефекте (прогон после Topic Chat correction: `REV01-review-2026-08-19T17-24-41-220Z`):

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

Corrected-policy rerun (`REV01-review-2026-08-19T17-24-41-220Z`), decision rule **expected**:

- Implementation на зелёном fixture ничего не менял; injection нарушил ARCH-01, тесты остались зелёными.
- REVIEW #1 findingKey: `complete-route-bypasses-task-service-transition`; evidence: `service.get(id)` + прямые `task.status` / `task.completedAt`; relatedAuthority ARCH-01. Один finding, без correctness-дубля.
- reviewAttempts=2; reviewRepairAttempts=1; blocking_fp=0; repeatedFinding=false
- review repair: write только `tasks/task-routes.ts`
- Tokens: review 3515/286; review_repair 11874/1011; total 28782/2684
- Wall ~43s
- Финальный workflow diff пустой — ожидаемо: injection откатили к fixture.

Первый прогон (`REV01-review-2026-08-19T15-31-34-772Z`): intended detected, но correctness restatement стал вторым blocker. Остаётся evidence misclassification, не аргумент для blanket demotion.

## Topic Chat conclusion

V3 implementation и corrected REV01 evidence приняты. Дополнительный natural/baseline experiment перед закрытием не нужен: цель Module 05 — показать механизм independent review → bounded repair после deterministic PASS — доказана на контролируемом probe.

Не блокирующие будущие вопросы:

- semantic normalization `findingKey` для одинаковых findings с разными формулировками;
- distinction misclassified architecture-as-correctness vs real uncovered correctness;
- накопление findings и recurring-pattern analytics;
- promotion подтверждённых recurring rules в deterministic checks.

Эти пункты не расширяются в Module 05 и передаются последующим tracing/eval/orchestration этапам по roadmap.
