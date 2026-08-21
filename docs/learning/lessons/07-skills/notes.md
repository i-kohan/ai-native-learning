# 07 — Skills

Практический журнал. Минимальный Skills mechanism поверх неизменённого V3. Фиксированный suite прогнан. Модуль **не** закрыт: Topic Chat пишет `theory.md` после review.

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

## Файлы, которые стоит лично просмотреть

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
```

Hash `efa5e14d5382c9108bd40dc471d62627bea07bb28b3676b4b523428d0dc29a25` одинаковый для R01 repair и REV01 review_repair.

Trace evidence:

- T01–T04: нет `skill_loaded`
- R01: `skill_loaded` сразу после `repair_started`, не на implementation/review
- REV01: `skill_loaded` сразу после `review_repair_started`; reviewer rounds 1/2 без skill

## Нюансы

- Skill входит в user message как `## Procedural context (reusable skill)`, не в `instructions`.
- Missing/empty/unknown skill бросает `SkillLoadError`, а не молча пропускается.
- Неверная progressive disclosure — diagnostic в eval, не hard contract 6/6.
- Efficiency: без major regression vs Module 06; REV01 input чуть выше из-за skill block на review_repair; R01 даже чуть дешевле на этом прогоне.

## Personal takeaways

- Skill имеет смысл только когда процедура уже повторяется и у неё есть внешняя проверка.
- Progressive disclosure доказывается отсутствием события, не только финальным PASS.
- Один skill на две роли работает, потому что evidence-type остаётся в episode contract, а не в SKILL.md.
