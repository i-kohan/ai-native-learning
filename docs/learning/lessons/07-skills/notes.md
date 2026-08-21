# 07 — Skills

Практический журнал. Минимальный Skills mechanism поверх неизменённого V3. Фиксированный suite прогнан, learning-critical code/traces проверены Topic Chat, теория закреплена в `theory.md`. **Topic Chat считает модуль готовым к формальному закрытию Master.**

## Что это за урок одной фразой

Повторяющаяся процедура ремонта живёт в одном `SKILL.md` и подгружается только в applicable repair episodes; role instructions остаются role-specific, а VERIFY/review/policy остаются у harness.

## Как устроено

```text
phase
→ skillIdForPhase (deterministic)
   implementation → none
   repair / review_repair → evidence-guided-repair
→ loadSkill(skillId) читает skills/<id>/SKILL.md
→ formatProceduralContext (отдельный labeled block, не role instructions)
→ model episode
→ существующий VERIFY / REVIEW
```

Команды:

- `cd harness && npm test` — детерминированные тесты, включая `tests/skills.test.ts`
- `cd harness && npm run benchmark:eval` — T01–T04 + R01 + REV01
- lesson copies: `docs/learning/lessons/07-skills/traces/`

## Файлы, которые были лично просмотрены

1. `skills/evidence-guided-repair/SKILL.md` — общая процедура ремонта по внешнему evidence
2. `harness/src/skills.ts` — `skillIdForPhase`, `loadSkill`, hash, `formatProceduralContext`
3. `harness/src/loop.ts` — точка интеграции: selection → load → procedural context → `skill_loaded`
4. `harness/src/instructions.ts` + `review-instructions.ts` — role-specific границы без дублирования процедуры
5. `harness/src/run.ts` / eval report — `skillLoads` в result и progressive-disclosure evidence

Поток: `runAgentLoop(phase)` → `skillIdForPhase` → `loadSkill` → user message = repo hints + procedural skill + episode contract → модель → harness VERIFY/REVIEW без изменения retry policy.

## Что специально не попало в skill

- max repair attempts / retry policy
- обязательный VERIFY control flow
- review policy
- tool/write permissions
- ARCH-01 и конкретные пути репозитория
- факты текущей задачи

Эти вещи остаются у harness, role instructions или episode contract.

## Фактический suite (2026-08-21)

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS  (skill @repair)
REV01 independent review    PASS  (skill @review_repair)
All fixed contracts         6 / 6
Hard regressions            none
Skill disclosure diagnostics none
```

Hash `efa5e14d5382c9108bd40dc471d62627bea07bb28b3676b4b523428d0dc29a25` одинаковый для R01 repair и REV01 review_repair.

Trace evidence:

- T01–T04: нет `skill_loaded`
- R01: `skill_loaded` только в `repair`, не на implementation/review
- REV01: `skill_loaded` только в `review_repair`; reviewer rounds 1/2 без skill

## Нюансы

- Skill входит в user message как `## Procedural context (reusable skill)`, не в `instructions`.
- Missing/empty/unknown skill бросает `SkillLoadError`, а не молча пропускается.
- Неверная progressive disclosure — diagnostic в eval, не hard contract 6/6; поэтому Module 07 success оценивается как `6/6 + no skill-disclosure diagnostics`.
- Efficiency: без major regression vs Module 06; один run не даёт оснований приписывать небольшие изменения tokens/wall time самому Skill.
- Experiment доказывает modular reuse + selective loading + preservation of authority/outcomes, а не причинный uplift model quality.

## Personal takeaways

- Skill = reusable procedural **HOW**; Spec = **WHAT**.
- Role говорит, кто агент сейчас; разные roles могут использовать один Skill.
- Harness решает, когда запускать repair и какой Skill загрузить; Skill не запускает сам себя и не владеет control flow.
- Evidence сообщает о проблеме, но не обязано правильно давать root cause или exact fix.
- Progressive disclosure доказывается не только финальным PASS, но и отсутствием Skill в нерелевантных phases.
- Повторяемость сама по себе не означает Skill: hard invariant лучше policy/check, exact operation — software, factual knowledge — context/docs.
- Discovery находит потенциально подходящие Skills; selection выбирает, какие реально загрузить в run.
- Skill должен переоцениваться: если перестал помогать или procedure стала deterministic, его можно изменить, автоматизировать или retire.

## Topic Chat review

Learning-critical implementation, traces и experiment reviewed. Существенных архитектурных проблем не найдено; Cursor repair не требуется.

Theory recap: `docs/learning/lessons/07-skills/theory.md`.

**Topic Chat recommendation:** Module 07 ready for Master closure. Следующий roadmap module здесь не выбирается.
