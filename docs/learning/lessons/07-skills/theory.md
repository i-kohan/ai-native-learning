# 07 — Skills

## Коротко

**Skill** — это переиспользуемое процедурное знание: **как обычно выполнять определённый класс работы**.

Он не определяет продуктовый результат, не расширяет полномочия агента и не заменяет внешний контроль.

```text
Spec     → WHAT должно получиться
Context  → какие факты нужны сейчас
Skill    → HOW обычно выполнять этот класс работы
Tool     → какие действия технически доступны
Policy   → что разрешено / обязательно / запрещено
Agent    → применяет контекст + skill, рассуждает и действует
Verifier → внешне доказывает результат
```

## Почему Skill — отдельная abstraction

Без Skills повторяющаяся procedure часто размазывается по role prompts:

```text
verification-repair role + duplicated repair procedure
review-repair role       + duplicated repair procedure
```

После выделения Skill:

```text
verification-repair role ─┐
                          ├─ evidence-guided-repair skill
review-repair role ───────┘
```

Role отвечает **кто ты сейчас и какую функцию выполняешь**, а Skill — **как выполнять повторяемую процедуру**.

## Наш Skill

`skills/evidence-guided-repair/SKILL.md` применяется к двум разным repair episodes:

- verification repair после deterministic VERIFY failure;
- review repair после accepted blocking review findings.

Общая procedure:

```text
external evidence
→ не считать его автоматически root cause или готовым fix
→ свериться с resolved spec и current repository state
→ исследовать relevant causal surface
→ выбрать smallest appropriate repair
→ сохранить unrelated behavior
→ вернуть управление harness
```

Evidence может быть разным, но процедура остаётся одной.

## Authority boundary

Skill — guidance, а не источник высшего authority.

В нашем harness приоритет концептуально такой:

```text
hard harness / tool constraints
↓
resolved spec
↓
current repository truth
↓
Skill procedure
↓
agent local judgment
```

Поэтому Skill не должен содержать или определять:

- max retry counts;
- когда запускать repair;
- обязательный VERIFY / REVIEW control flow;
- tool permissions / write scope;
- текущие repo facts;
- конкретные architecture invariants вроде ARCH-01;
- продуктовые требования текущей задачи.

Например `maxRepairAttempts=2` остаётся harness-owned policy, а `write_file` физически ограничивает доступ независимо от текста Skill.

## Evidence ≠ prescribed fix

Важное правило `evidence-guided-repair`:

> Внешнее evidence говорит, что есть проблема, но не обязано правильно объяснять root cause или HOW её чинить.

Даже если reviewer предлагает точный fix, repair agent должен проверить current repo + spec и независимо подтвердить решение.

```text
review finding: "change X to Y"
       ↓
не слепо выполнить
       ↓
проверить evidence + repo + spec
       ↓
самостоятельно выбрать repair
```

Это защищает от cargo-cult repair.

## Skill selection

В Module 07 selection специально deterministic:

```text
implementation → no skill
repair         → evidence-guided-repair
review_repair  → evidence-guided-repair
```

Это позволяет изучить Skills без смешивания темы с semantic/model routing.

В production discovery и selection могут быть отдельными этапами:

- **discovery** — какие Skills потенциально подходят;
- **selection** — какие из найденных реально загрузить в конкретный run.

## Progressive disclosure

Skill не должен попадать в каждый prompt просто потому, что существует.

```text
implementation → не загружаем repair skill
repair         → загружаем
reviewer       → не загружаем
review_repair  → загружаем
```

Это уменьшает context clutter и снижает риск нерелевантной procedure.

В нашем experiment progressive disclosure доказан traces:

- T01–T04: no `skill_loaded`;
- R01: skill загружен только для `repair`;
- REV01: skill загружен только для `review_repair`.

## Provenance / contentHash

`skillId` сам по себе не гарантирует, что два run использовали одинаковый Skill content.

Поэтому trace сохраняет:

```text
skillId
phase
contentHash
```

Если `SKILL.md` изменится, hash изменится. Это маленькая версия production provenance/version tracking.

## Когда НЕ нужен Skill

Повторяемость сама по себе недостаточна.

### Hard invariant

Например:

> migrations нельзя менять руками.

Если нарушение неприемлемо и правило можно формализовать, лучше:

```text
policy / deterministic check
```

### Deterministic operation

Например:

> после изменения schema всегда запусти generator.

Если это можно надёжно автоматизировать:

```text
software / script
```

### Factual knowledge

Например:

> где лежит API schema в этом repo.

Это скорее:

```text
context / docs
```

### Reusable uncertain procedure

Например:

> как диагностировать repair по внешнему evidence, когда root cause заранее неизвестен.

Это хороший Skill candidate.

## Skill → software evolution

Skill не обязан жить вечно.

```text
uncertain reusable procedure
→ Skill

procedure стала exact + automatable
→ deterministic software/check
```

Если новый model уже стабильно делает задачу без Skill или Skill перестал улучшать результаты, его надо переоценить, изменить или удалить.

Skill — не вечная истина.

## Как Skills появляются в зрелой системе

Specs alone недостаточно, потому что Spec описывает **WHAT**, а Skill — **HOW**.

Более полезные источники кандидатов:

```text
specs
+ execution traces
+ successful tool sequences
+ repairs
+ review findings
+ verifier outcomes
```

Возможный production lifecycle:

```text
completed runs
→ extract / cluster recurring procedures
→ candidate Skill
→ classify destination
   ├─ factual knowledge → context/docs
   ├─ hard invariant → policy/check
   ├─ deterministic operation → software
   └─ uncertain reusable procedure → Skill
→ human review
→ controlled eval
→ promote / reject
```

Automatic discovery не означает automatic production activation: найденную procedure сначала нужно проверить и классифицировать.

## Production lens

Наш минимальный mechanism:

```text
phase
→ hardcoded skill id
→ load SKILL.md
→ inject procedural context
→ agent run
→ trace skill id/hash
```

В крупной системе вокруг той же abstraction могут появиться:

```text
Skill Registry
→ metadata / owner / provenance / lifecycle
→ discovery
→ selection
→ scope / policy compatibility
→ progressive disclosure
→ agent execution
→ per-skill traces/evals
→ update / rollback / retire
```

Registry, routing и governance — инфраструктура вокруг Skill, а не другая основная идея.

## Что доказал Module 07 experiment

Experiment **не доказал**, что Skill сделал модель умнее: R01 и REV01 проходили и раньше.

Он доказал более точную гипотезу:

> Общую evidence-guided repair procedure можно вынести из двух role-specific instruction blocks в один reusable Skill, selectively загружать в два разных repair episodes и сохранить существующие outcomes и authority boundaries.

Fresh fixed suite:

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed contracts         6 / 6
Hard regressions            none
Skill disclosure diagnostics none
```

R01 и REV01 использовали один и тот же `evidence-guided-repair` content hash.

## Что важно запомнить

1. **Skill = reusable HOW, не WHAT.**
2. **Skill не расширяет authority.** Capabilities и policy принадлежат harness/tool layer.
3. **Role и Skill — разные оси.** Разные roles могут использовать один Skill.
4. **Evidence не равно diagnosis или exact fix.** Agent должен проверять его относительно spec/repo.
5. **Progressive disclosure важнее “загрузить всё”.** Skill нужен только там, где applicable.
6. **Discovery ≠ selection.** Сначала кандидаты, потом фактический выбор.
7. **Не всё повторяемое должно стать Skill.** Hard rules → policy/checks; exact operations → software; facts → context/docs.
8. **Skills должны измеряться и эволюционировать.** Не помогает — изменить, автоматизировать или retire.
