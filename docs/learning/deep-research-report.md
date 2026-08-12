# AI-native software engineering и agentic development: состояние на август 2026 года

## Главный вывод и архитектура frontier workflow

По состоянию на **8 августа 2026 года** наиболее зрелая форма AI-native software engineering — это уже не «IDE с очень хорошим автодополнением» и даже не «выдать coding agent большой PRD и подождать PR». Это **инженерия системы вокруг агентов**: репозиторий, спецификации, executable environment, инструменты, sandbox, policy layer, контрольный цикл, модели, контекст, тесты, независимая проверка, durable state, retries, telemetry и evals проектируются как единая execution platform.

Именно этот сдвиг хорошо виден в эксперименте OpenAI Harness Engineering от 11 февраля 2026 года. Команда построила внутренний продукт примерно на миллион строк, где код, тесты, CI, документация, observability и tooling генерировались Codex; авторы формулируют новый центр человеческой работы как проектирование environments, specification of intent и feedback loops, а не ручное написание кода. При этом OpenAI отдельно предупреждает, что достигнутая автономность сильно зависит от специфической структуры и tooling данного репозитория и пока не должна считаться автоматически переносимой на любой codebase. citeturn14view0

Мой главный вывод из сопоставления OpenAI, Anthropic, GitHub и современных agent platforms таков:

> **Frontier agentic engineering — это преимущественно harness engineering + evaluation engineering, а не prompt engineering и не “управление армией агентов”.**

Модель задаёт верхнюю границу доступной интеллектуальной способности. **Harness определяет, какую долю этой способности удаётся регулярно превратить в корректно доставленный software change.** Anthropic прямо пишет, что harness design существенно влияет на frontier agentic coding; OpenAI пришла к тому же через практический опыт, обнаружив, что многие провалы агента объяснялись отсутствующим capability, плохой legibility или отсутствием enforceable feedback, а не недостаточной «силой» промпта. citeturn15view1turn14view0

**Модель современной software factory удобно представлять так:**

```text
                         ┌─────────────────────────┐
                         │         HUMAN           │
                         │ intent / judgment /     │
                         │ architecture / policy   │
                         └────────────┬────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │  INTENT / SPEC LAYER    │
                         │ requirements            │
                         │ constraints             │
                         │ acceptance criteria     │
                         │ architecture invariants │
                         └────────────┬────────────┘
                                      │
                                      ▼
                 ┌────────────────────────────────────┐
                 │       ORCHESTRATION / CONTROL      │
                 │ queue / issue state / DAG          │
                 │ scheduler / routing / budgets      │
                 │ retries / checkpoints / escalation │
                 └───────────────┬────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
          ┌──────────────────┐      ┌──────────────────┐
          │ AGENT / LOOP     │ ...  │ AGENT / LOOP     │
          │ plan → act →     │      │ review / test /  │
          │ observe → repair │      │ specialize       │
          └─────────┬────────┘      └─────────┬────────┘
                    │                         │
                    └────────────┬────────────┘
                                 ▼
             ┌─────────────────────────────────────┐
             │ MODEL PORTFOLIO / ROUTER            │
             │ hard reasoning / coding / cheap /   │
             │ multimodal / browser / reviewer     │
             └────────────────┬────────────────────┘
                              │
                              ▼
             ┌─────────────────────────────────────┐
             │ CONTEXT + SKILLS + TOOLS            │
             │ repo map / docs / memory / skills   │
             │ shell / git / MCP / browser / APIs  │
             └────────────────┬────────────────────┘
                              │
                              ▼
             ┌─────────────────────────────────────┐
             │ ISOLATED EXECUTION ENVIRONMENT      │
             │ worktree / container / sandbox      │
             │ app / DB / logs / metrics / browser │
             └────────────────┬────────────────────┘
                              │
                              ▼
             ┌─────────────────────────────────────┐
             │ IMPLEMENTATION                      │
             │ code / migrations / tests / docs    │
             └────────────────┬────────────────────┘
                              │
                              ▼
             ┌─────────────────────────────────────┐
             │ VERIFICATION                        │
             │ unit / integration / e2e / lint     │
             │ architecture / security / browser   │
             │ independent agent review            │
             └────────────────┬────────────────────┘
                              │
                    fail ─────┴───── pass
                      │                 │
                      ▼                 ▼
               repair / retry      PR / CI / merge
                      │                 │
                      └──────┐   ┌──────┘
                             ▼   ▼
                    TRACES / METRICS / EVALS
                             │
                             ▼
                 harness / skill / rule improvement
```

OpenAI Codex описывает базовый agent loop как повторение `input → model inference → tool request → tool execution → observation → next inference`; конечным результатом coding agent часто оказывается не сообщение, а изменённое состояние environment — файлы, запущенные тесты, коммиты и PR. citeturn3view2

Поверх этого минимального цикла появляется **harness**. В практическом смысле это всё, что превращает модель в работающего software agent:

`model + instructions + context acquisition + tools + execution environment + state + verification + retry policy + permissions + observability + delivery integration`.

Определение Anthropic почти совпадает: agent harness обрабатывает входы, организует tool calls и возвращает результат; при оценке «агента» фактически оцениваются **модель и harness вместе**. citeturn15view4

Самый важный сдвиг 2026 года заключается ещё в одном: **единицей управления становится не chat/session, а engineering outcome**. OpenAI Symphony возник именно потому, что люди могли комфортно следить лишь примерно за тремя–пятью интерактивными agent sessions, после чего context switching становился новым bottleneck. Symphony превращает issue tracker в control plane: задачи получают собственные workspaces и агентные runs, orchestrator следит за состоянием, перезапускает stalled work и позволяет человеку управлять deliverables вместо терминальных сессий. citeturn14view1

Поэтому frontier workflow выглядит скорее так:

**issue → executable specification → orchestrated run → isolated implementation → deterministic verification → independent criticism → bounded repair → CI → evidence → delivery → eval feedback**

а не:

**prompt → code → human review**.

**Статус зрелости практик на август 2026 года:**

| Статус | Что сюда относится |
|---|---|
| **Established practice** | single-agent tool loops; repository instructions; executable tests; sandbox/workspace isolation; PR/CI integration; spec/plan artifacts; retry loops; structured review; tracing; explicit permissions |
| **Rapidly emerging** | issue-tracker-as-control-plane; Agent Skills; repository-scoped memory; model routing; long-running context resets/handoffs; browser-based autonomous verification; agentic CI workflows |
| **Useful but conditional** | planner/worker separation; parallel agents; independent LLM reviewers; persistent semantic memory; state-machine orchestration |
| **Experimental** | deep hierarchies of agents; large coding swarms; broadly autonomous multi-repository architecture changes; self-modifying harnesses without human gates |
| **Mostly hype when treated as default** | “more agents = more capability”; agents talking freely to one another; putting every API behind MCP; giant AGENTS.md files; unrestricted persistent memory; LLM-based checks where deterministic checks are available |

Это согласуется с Anthropic: в их multi-agent research system большое преимущество возникало для breadth-first задач с действительно независимыми направлениями, но multi-agent использовал существенно больше tokens, а сама Anthropic отдельно отмечает, что **большинство coding tasks хуже распараллеливаются**, чем research, и текущим LLM всё ещё трудно координировать друг друга в real time. citeturn16view3turn16view4

Именно поэтому ваша конечная цель должна звучать не как «научиться запускать больше coding agents», а как:

> **научиться проектировать проверяемую execution system, внутри которой один или несколько agents могут долго и безопасно превращать intent в verified repository state с минимальным количеством человеческих interventions.**

## Понятийная карта и инженерные принципы

Многие термины в этой области пока не имеют строгих общеотраслевых определений. Ниже — практическая operational vocabulary, которая хорошо согласуется с архитектурами OpenAI, Anthropic и GitHub.

| Термин | Практический смысл | Главный вопрос инженера |
|---|---|---|
| **AI-assisted development** | Человек владеет главным control loop; AI помогает писать, исследовать, тестировать и review. | «Как AI ускорит мою работу?» |
| **AI-native development** | SDLC изначально проектируется так, чтобы значительную часть execution loop могли выполнять agents; человек задаёт intent, constraints, policies и решает exceptions. | «Как сделать систему выполнимой агентом?» |
| **Agentic engineering** | Инженерия автономных model→tool→observation loops и систем вокруг них. | «Как агент принимает следующее действие и узнаёт результат?» |
| **Harness engineering** | Проектирование scaffolding вокруг модели: context, tools, environment, policies, loops, verification, state, observability. | «Почему модель способна решить задачу, а наш агент не решает её стабильно?» |
| **Spec-driven development** | Перевод intent в versioned structured artifacts: specification → technical plan → tasks → acceptance criteria → implementation. | «Можно ли однозначно проверить, что агент построил именно нужное?» |
| **Context engineering** | Управление всеми tokens, которые модель видит на каждом шаге, а не только system prompt. | «Какая информация нужна именно сейчас и что следует исключить?» |
| **Agent orchestration** | Dispatch, sequencing, dependencies, concurrency, routing и lifecycle нескольких runs/agents. | «Что должно выполняться кем, когда и при каких условиях?» |
| **Agent loop** | `observe → reason/plan → action/tool → observation → repeat`. | «Каков сигнал продолжать, чинить, остановиться или escalate?» |
| **Subagent** | Отдельный bounded agent invocation с собственным context, objective и tools. | «Стоит ли выделить независимую подзадачу в отдельный context?» |
| **Skill** | Version-controlled reusable procedural knowledge, загружаемое по необходимости. | «Как перестать заново объяснять агенту повторяющийся процесс?» |
| **Tool** | Action interface: shell, git, browser, DB, issue API, search, test runner и т. п. | «Какое реальное действие агент может совершить?» |
| **MCP** | Стандартизированный protocol/interface для предоставления model applications tools/resources/context. | «Как сделать capability переносимым между clients/harnesses?» |
| **Memory** | Persisted knowledge из прошлых runs, доступное в будущих. | «Что стоит помнить и как доказать, что оно всё ещё истинно?» |
| **Eval** | Controlled experiment, измеряющий поведение model+harness на task suite. | «Стало ли изменение действительно лучше?» |
| **Tracing** | Episode-level запись model calls, tools, state transitions, timings, token/cost и errors. | «Где именно система потратила время/деньги или сломалась?» |
| **Guardrail** | Hard или soft constraint на допустимые действия и outputs. | «Что агент не имеет права сделать, даже если считает это полезным?» |
| **Durable execution** | Workflow продолжает корректно существовать после crash/restart/timeouts, сохраняя state и retry semantics. | «Что произойдёт, если процесс упадёт через три часа?» |

**AI-assisted и AI-native различаются прежде всего владельцем цикла.** В вашем текущем workflow человек, скорее всего, остаётся scheduler, state store, evaluator и exception handler одновременно: вы формулируете PRD, запускаете агента, смотрите результат, инициируете review, решаете, когда тестировать и когда продолжать. В AI-native системе эти операции постепенно материализуются в software. Именно это OpenAI описывает как перенос труда с непосредственного coding на scaffolding, environments и feedback loops. citeturn14view0

**Spec-driven development — не просто “написать более длинный PRD”.** GitHub Spec Kit представляет SDD как intent-first workflow с последовательными артефактами specification → plan → tasks → implementation. На 16 июля 2026 года проект поддерживал десятки coding-agent integrations и превратился в расширяемый process harness, а не в tool-specific prompt template. citeturn15view5

Хорошая spec для autonomous agent должна как минимум отделять:

```text
WHY
problem / user outcome

WHAT
behavior / requirements / non-requirements

CONSTRAINTS
architecture / APIs / security / compatibility / scope

ACCEPTANCE
observable pass/fail criteria

VERIFICATION
commands / tests / browser journeys / metrics

ESCALATION
which ambiguities require human judgment
```

Критический принцип: **specification должна уменьшать пространство допустимых решений, не предписывая без необходимости конкретную реализацию**. OpenAI описывает похожий подход для architecture: строго enforce boundaries и invariants, но оставлять агенту локальную свободу реализации. citeturn14view0

**Context engineering шире prompt engineering.** Anthropic определяет context как весь набор tokens, доступных при inference: instructions, tools, MCP definitions, external data, message history и другие материалы. В длинных loops этот набор постоянно растёт, поэтому его приходится циклически отбирать, сжимать и обновлять. citeturn15view3

Практически полезная модель:

```text
effective context =
    task intent
  + relevant repository state
  + current plan/state
  + applicable architecture rules
  + active skill
  + minimal tool descriptions
  + recent observations
  + verified memory
  - irrelevant history
  - stale instructions
  - unused tool schemas
  - redundant source dumps
```

Отсюда возникает **progressive disclosure**. OpenAI отказалась от огромного `AGENTS.md`, потому что он занимал valuable context, быстро устаревал и делал все правила одинаково «важными». Вместо этого около 100 строк `AGENTS.md` стали картой к versioned `docs/`, architecture docs, product specs, execution plans и security/reliability references. citeturn14view0

Agent Skills формализуют почти тот же принцип на процедурном уровне. В current Agent Skills standard skill — это каталог с обязательным `SKILL.md` и необязательными scripts/references/assets. На старте агент видит лишь metadata; полные инструкции подгружаются при activation, то есть skills являются ещё одним механизмом progressive disclosure. Формат был создан Anthropic и опубликован как open standard в декабре 2025 года. citeturn19view0turn19view1

Разница между **skill** и **tool** фундаментальна:

> tool = **что агент физически может сделать**;  
> skill = **как правильно выполнять определённый процесс**.

Например:

```text
Tool:
    browser.navigate(url)

Skill:
    verify-checkout-flow/
        1. start clean user
        2. add item
        3. verify cart state
        4. checkout
        5. capture screenshots
        6. inspect console
        7. produce evidence.json
```

MCP, в свою очередь, преимущественно решает проблему standardized capability access. Последняя спецификация MCP на момент этого исследования датирована **28 июля 2026 года** и перешла к stateless protocol core, добавив, среди прочего, multi-round-trip requests, routing и authorization changes. citeturn13view6

Но **MCP не следует использовать автоматически для всего**. GitHub обнаружила, что регистрация 40 GitHub MCP tools могла добавлять примерно 10–15 KB schemas в каждый turn; простые deterministic reads вроде загрузки PR diff часто дешевле выполнить обычным CLI pre-step, вообще не тратя reasoning turn. citeturn18view0

Это важный общий принцип:

> **Use an LLM only where uncertainty or judgment requires an LLM.**

`git diff`, загрузка issue metadata, hashing, dependency graph, test execution, parsing JSON, checking a linter — обычно deterministic software.

**Memory тоже не означает “vector DB со всеми предыдущими разговорами”.** У GitHub Copilot repository memory основная проблема оказалась не retrieval, а staleness. Их решение — хранить memory вместе с citations на конкретные code locations и повторно проверять эти citations против текущей ветки перед использованием. В тестировании GitHub такой memory layer дал небольшие, но измеримые улучшения precision/recall review и merge rate, что является хорошим примером emerging practice вместо магической «вечной памяти». citeturn18view3turn18view4

Для coding harness полезно разделять память на четыре уровня:

```text
Ephemeral context
    current observations / recent turns

Episode state
    plan / todo / failing tests / current hypothesis

Repository memory
    architecture docs / conventions / verified facts / exec plans

Historical analytics
    traces / prior failures / eval outcomes / cost data
```

**Durable execution — это не long context window.** Для многочасового agent job вам нужны persisted workflow state, idempotent transitions, timeout/retry semantics, checkpoints и восстановление. OpenAI Symphony, например, использует orchestrator-owned state, isolated workspaces и retry/backoff; Temporal показывает тот же general pattern через durable workflows, timeouts и automatic retry policies. citeturn14view1turn19view4

И важнейший принцип long-running execution:

> **conversation history ≠ durable state.**

Anthropic обнаружила, что compaction одной длинной conversation недостаточно. В long-running harness они получили лучший результат, когда agents делали маленькие инкременты, фиксировали их в git и `progress` artifact, а новые sessions могли начать с чистого context. В последующем harness Anthropic использовала explicit context resets + structured handoff для борьбы с coherence loss и так называемой context anxiety. citeturn16view6turn16view5

## Frontier practices и реальность против hype

**OpenAI Harness Engineering является, пожалуй, самым чистым публичным примером repository-as-harness.** Ключевая идея там не «Codex невероятно хорошо пишет код», а то, что repository был постепенно превращён в agent-legible operating environment. Приложение можно было запускать отдельно на каждом git worktree; агент получил Chrome DevTools/DOM/screenshots/navigation и локальный observability stack с logs, metrics и traces. OpenAI сообщала о runs продолжительностью до шести часов. citeturn14view0

Особенно важен подход к failures:

```text
BAD:
agent failed
→ rerun same prompt
→ use stronger model
→ add 5,000 tokens of instructions

BETTER:
agent failed
→ classify missing capability
→ was context unavailable?
→ was feedback weak?
→ was success ambiguous?
→ was required action impossible?
→ was policy blocking legitimate work?
→ add tool / rule / test / doc / skill / evidence
→ rerun benchmark
```

OpenAI прямо пишет, что их ответом на failure почти никогда не было «try harder»: вместо этого команда выясняла, какого capability, legibility или enforceable structure не хватает. citeturn14view0

Это и есть **harness engineering mindset**.

Следующий шаг OpenAI — **Symphony**, опубликованный 27 апреля 2026 года. Его интереснее рассматривать не как продукт, а как orchestration reference architecture. Issue tracker становится source of work; issue получает isolated workspace; scheduler ограничивает concurrency; runner запускает agent; state определяет lifecycle и retries. Сложные задачи могут раскладываться в dependency graph и выполняться параллельно, когда prerequisites разрешены. citeturn14view1

При этом OpenAI описывает важный отрицательный результат: слишком жёсткая state machine тоже может стать anti-pattern. По мере роста model capability разработчики стали предпочитать давать agents objectives + tools + context и меньше предписывать микроскопические переходы между состояниями. То есть **orchestrate lifecycle strongly, reasoning path lightly**. citeturn4view6turn4view7

**Anthropic long-running harnesses дают второй важный набор уроков.** В ноябре 2025 года команда обнаружила два классических failure modes: agent пытается реализовать слишком много за один session и оставляет half-built state; следующий context начинает угадывать, что происходило. Их рабочая схема использовала initializer, explicit feature list, incremental implementation, git commits и progress artifact. citeturn15view0turn16view6

В марте 2026 года Anthropic пошла дальше: planner → generator → evaluator с multi-hour application development. Но важнейший результат здесь не «три агента лучше одного», а **independent evaluator**. Авторы обнаружили, что self-evaluation систематически слишком благосклонна; отделение generator от skeptical evaluator давало более полезный feedback signal. citeturn15view1turn16view5

Отсюда practical hierarchy verification:

```text
strongest signal
    executable deterministic acceptance test
    invariant / compiler / typechecker / linter
    database / API / browser observable state
    performance/security assertion
    independent structured reviewer
    same-agent self-review
weakest signal
    agent says "done"
```

**Multi-agent systems заслуживают особенно скептического отношения.** У Anthropic multi-agent research architecture действительно значительно превзошла single-agent baseline на их внутреннем breadth-first research eval, но система использовала примерно в 15 раз больше tokens, чем обычный chat workload; Anthropic отдельно отмечает, что coding имеет меньше truly parallelizable work и больше dependencies. citeturn15view2turn16view3

Поэтому в software engineering я бы использовал следующую default policy:

```text
Start:
    1 capable agent
    + good tools
    + good context
    + deterministic verifier

Add second agent only when:
    A. independent reviewer gives a genuinely independent signal
    B. tasks can be parallelized with little shared mutable state
    C. separate context window solves context overload
    D. specialization requires substantially different tools/instructions
    E. parallel exploration is worth the token/cost multiplier
```

GitHub приходит к тому же с distributed-systems perspective: при добавлении нескольких agents возникают shared state, ordering, handoff и nondeterminism failure surfaces. Их рекомендация — typed boundaries, restricted action schemas, logging, explicit retries и design-for-failure. citeturn16view0turn16view1

**То, что часто выглядит advanced, но ухудшает систему:**

| Anti-pattern | Почему ломается | Что делать вместо |
|---|---|---|
| 8 agents вместо 1 | coordination + duplicated context + cost | сначала prove parallelism |
| Planner пишет гигантский immutable plan | reality diverges после первых tool results | rolling plan + checkpoints |
| Каждый шаг — LLM call | дорогая и nondeterministic automation | deterministic code outside agent loop |
| Все MCP tools всегда активны | schema/context overhead, wrong tool choice | task-scoped toolsets |
| Огромный `AGENTS.md` | context pollution + staleness | short map + progressive disclosure |
| Infinite Ralph loop | token runaway / repeated failure | bounded loop + stop condition |
| Agent сам определяет “готово” | optimistic self-evaluation | external acceptance state |
| Persistent unverified memory | stale architecture assumptions | citations + JIT verification |
| One workspace for parallel agents | race/conflicting edits | worktree/container per task |
| Maximum-capability model everywhere | cost/latency without quality gain | empirical routing |
| Full autonomy before evals | неизвестно, стало лучше или хуже | eval harness first |
| Natural-language agent handoffs | information loss / ambiguity | typed artifact/state schema |

GitHub уже увидела реальный пример runaway loop: одна ошибочная sandbox allowlist заставила agent вместо нужного compiler action попасть в **64-turn fallback loop**. После исправления policy pathology исчезла. Это отличный пример того, почему tracing tool failures важнее очередного prompt trick. citeturn18view2

**Spec Kit** полезен именно как mechanism for intent preservation, но не стоит превращать SDD в бюрократию. На маленьком bugfix спецификация на десять страниц может стоить дороже исправления. Правильная единица — «минимальный artifact, достаточный для независимого исполнителя и verifier». GitHub описывает Spec Kit как расширяемую specification-driven систему, а не как требование использовать одинаково тяжёлый ceremony для любой задачи. citeturn15view5

**GitHub Agentic Workflows** к августу 2026 года — важный emerging production pattern: natural-language/Markdown workflow компилируется в GitHub Actions, поддерживаются разные coding agents, а execution получает sandbox, read-only defaults и controlled writes. Но статус технологии на 8 августа 2026 года — **public preview**, объявленный 11 июня, а не зрелый universal production standard. citeturn19view2turn19view3

Здесь особенно правильна идея разделения:

```text
deterministic CI:
    build
    unit tests
    lint
    typecheck
    known policies

agentic CI:
    explain CI failure
    triage issue
    identify suspicious architectural change
    propose missing tests
    maintain documentation
    investigate flaky behavior
```

Agentic workflow должен **дополнять deterministic CI, а не заменять его**.

**Security становится enabler autonomy, а не противоположностью autonomy.** Anthropic показала, что filesystem + network sandboxing может одновременно уменьшить approval fatigue и позволить агенту действовать свободнее внутри safe boundary; GitHub Agentic Workflows также использует read-only defaults, network isolation, tool allowlisting и controlled safe outputs. citeturn17view0turn19view2

Правильная security model:

```text
agent is untrusted
↓
sandbox is trusted boundary
↓
credentials live outside sandbox
↓
network is allowlisted/proxied
↓
write capabilities are scoped
↓
irreversible operations require policy/human gate
↓
everything is audited
```

Это гораздо лучше модели:

```text
agent can do anything
but asks "Are you sure?" 80 times
```

**Open-source ecosystem** тоже постепенно движется от «coding bot» к agent platform. OpenHands, например, позиционируется как model-agnostic execution layer с isolated environments, parallel agents, GitHub/GitLab/CI integrations, audit/budget controls и SDK для построения custom agent workflows. Его ценность для вашего обучения не в использовании OpenHands как конечного инструмента, а в изучении того, какие abstractions нужны production harness: workspace, runtime, agent SDK, integrations, security и concurrency. citeturn19view5

И наконец — необходимая анти-hype оговорка. High benchmark scores ещё не означают одинаковую productivity gain у реальных инженеров. METR в исследовании 2025 года наблюдала slowdown у выбранных опытных open-source разработчиков; новые данные 2026 года дают гораздо более неопределённую и, возможно, улучшившуюся картину, но сами авторы подчёркивают сильные selection effects и слабость точной оценки. citeturn17view7

То есть правильный вопрос в 2026 году не:

> «Стали ли AI agents вообще лучше человека?»

а:

> **«На моём task distribution, repository и harness какая конфигурация даёт лучший quality/autonomy/cost frontier?»**

## Каталог architecture patterns

Ниже — patterns, которые имеет смысл уметь не просто узнавать, а **выбирать и отвергать**.

| Pattern | Когда использовать | Когда не использовать | Trade-offs и failure modes |
|---|---|---|---|
| **Planner → worker** | Большая задача требует decomposition до coding | Маленький fix; план быстро устаревает | Better direction; риск fictional upfront plan |
| **Orchestrator → worker** | Несколько independent tasks / queue / issue tracker | Один linear task | Высокая throughput; scheduler/state complexity |
| **Agent-as-tool** | Lead agent нужен bounded specialist: research, security, DB | Подзадача тесно связана с текущим context | Хорошая isolation; summary может потерять детали |
| **Handoff** | Context reset или смена specialist | В пределах короткого run | Лечит context degradation; artifact должен быть complete |
| **Parallel fan-out/fan-in** | Независимый repo research, module tasks, competing hypotheses | Shared files/state, serial dependencies | Wall-clock gain; conflict + duplicated cost |
| **Generator → critic** | Subjective quality или слабая self-evaluation | Есть perfect deterministic grader | Better feedback; critic может ошибаться или быть correlated |
| **Implementer → reviewer** | PR-level independent QA | Micro-change с exhaustive tests | Ловит omissions; extra tokens/latency |
| **Test → fix loop** | Reproducible failing test exists | Tests incomplete or wrong | Один из strongest loops; risk overfitting/test gaming |
| **Review → repair loop** | Structured review findings | Unstructured reviewer chatter | Raises quality; can oscillate |
| **Ralph-style loop** | Есть objective + backpressure + stable verifier | Нет termination condition | Прост и powerful; uncontrolled versions become token furnace |
| **Hierarchical agents** | Большая decomposition tree с truly separate domains | Обычные tickets | Scales context; coordination grows rapidly |
| **Event-driven agents** | issue/PR/CI/security events | Interactive design exploration | Natural production integration; idempotency critical |
| **State-machine orchestration** | Lifecycle и recovery хорошо известны | Сам reasoning path неизвестен | Auditability; excessive rigidity |
| **Model routing** | Разный difficulty/cost profile | Tiny volume without eval data | Cost/latency gains; wrong classification can hurt quality |
| **Progressive disclosure** | Large repository / many procedures | Почти всегда полезен | Lower context; retrieval/path quality becomes critical |
| **Repository-as-memory** | Durable architectural/product knowledge | Fast-changing unverified facts | Portable/versioned; stale docs cause drift |
| **Isolated worktrees** | Parallel execution / per-task app | Pure read-only task | Excellent isolation; DB/ports/integration management needed |
| **Agent-generated verification evidence** | UI, operational, E2E behavior | Evidence is only an unverified prose claim | Makes review scalable; evidence itself must be trustworthy |

**Planner–worker.** Используйте planner не потому, что «planning agent — advanced», а когда decomposition уменьшает uncertainty для worker. Plan должен быть living artifact: assumptions, dependencies, acceptance tests, progress и decisions. OpenAI хранит complex execution plans в repository вместе с decision/progress logs; это намного полезнее ephemeral chain-of-thought plan. citeturn14view0

**Orchestrator–worker.** Отличается тем, что orchestrator управляет не только reasoning decomposition, но и lifecycle. Symphony — хороший exemplar: task state, workspace allocation, bounded concurrency, scheduling, retry. citeturn14view1

**Agent-as-tool** — мой preferred multi-agent default. Вместо «агенты общаются в group chat» lead agent получает инструменты вроде:

```text
review_security(diff) -> Finding[]
inspect_database_change(diff) -> Finding[]
research_api(question) -> Evidence[]
run_visual_qa(url, journeys) -> QaReport
```

У каждой функции есть objective, input schema, output schema и budget. Это значительно легче наблюдать и eval'ить, чем свободную conversational delegation. GitHub также рекомендует typed interfaces и constrained actions на agent boundaries. citeturn16view1

**Handoffs и context resets.** Для long-running task handoff должен быть больше похож на checkpoint, чем на conversation summary:

```yaml
task_state:
  objective: ...
  completed:
    - ...
  current_branch: ...
  commits:
    - ...
  acceptance:
    passed: [...]
    failing: [...]
  current_failure:
    command: ...
    output_ref: ...
  hypotheses:
    - ...
  next_actions:
    - ...
  constraints:
    - ...
```

Anthropic обнаружила, что fresh context + structured handoff может восстановить coherence, хотя за это приходится платить orchestration complexity, latency и additional tokens. citeturn16view5

**Fan-out/fan-in** лучше всего работает там, где decomposition почти embarrassingly parallel:

```text
lead
 ├─ inspect API impact
 ├─ inspect database impact
 ├─ inspect frontend impact
 └─ inspect tests
        ↓
      synthesize
```

Плохо:

```text
agent A edits UserService.ts
agent B edits same UserService.ts
agent C edits same tests
agent D changes interfaces all depend on
```

Anthropic получила большой multi-agent benefit на breadth-first research именно благодаря independent contexts; одновременно она предупреждает, что coding чаще имеет shared dependencies. citeturn16view3

**Generator–critic / implementer–reviewer** имеет смысл использовать тогда, когда reviewer действительно независим: отдельный context, preferably diff + spec + architecture rules, а не полный conversation implementer. Anthropic прямо обнаружила, что standalone skeptical evaluator проще сделать полезным, чем заставлять generator объективно оценивать собственную работу. citeturn16view5

**Test–fix loop** является базовой атомарной единицей reliable agentic engineering:

```text
run verifier
→ normalize failure
→ agent diagnoses
→ minimal edit
→ rerun targeted verifier
→ rerun regression suite
→ pass OR retry limit
```

Ключевое слово — **normalize**. Не бросайте агенту 50 MB CI logs; выделите failing command, assertion, stack trace и relevant artifacts.

**Review–repair loop** должен иметь termination semantics. Например:

```text
max_review_rounds = 3

STOP_SUCCESS:
  no severity >= medium
  acceptance checks pass
  architecture checks pass

STOP_ESCALATE:
  same finding repeats twice
  reviewer and implementer disagree on requirement
  fix requires scope expansion
```

**Ralph-style loop** полезен не как магическая технология, а как принцип persistent iteration under feedback. Anthropic отмечает convergence community toward continuous iteration schemes, а OpenAI описывает похожую review-until-satisfied процедуру. Без verifier/backpressure Ralph быстро превращается в endless retry loop. citeturn15view1turn14view0

**State machine** лучше использовать для lifecycle:

```text
READY
→ RUNNING
→ VERIFYING
→ REVIEWING
→ REPAIRING
→ CI
→ DONE

            ↘ BLOCKED
            ↘ ESCALATED
            ↘ FAILED_RETRYABLE
```

Но не обязательно для внутреннего reasoning агента. Это соответствует эволюции OpenAI Symphony: control-plane state важен, но чрезмерно script'ованный cognitive path становится ограничением. citeturn14view1

**Repository-as-memory** следует считать фундаментальным pattern. OpenAI делает repo-local versioned docs системным источником истины и механически проверяет документацию; GitHub memory добавляет verified memories с citations на живой code. citeturn14view0turn18view3

**Isolated worktree** нужен не только для git conflict avoidance. Хорошая isolation boundary включает:

```text
worktree
+ dependency/env state
+ isolated database/schema
+ allocated ports
+ app process
+ logs/metrics/traces
+ browser session
+ sandbox policy
+ artifacts
```

Так agent может самостоятельно воспроизвести bug, запустить приложение и проверить исправление. Именно такую per-worktree application legibility использует описанный OpenAI harness. citeturn14view0

**Verification evidence** должна превращать результат в inspectable artifact:

```json
{
  "acceptance": "checkout works on mobile",
  "status": "pass",
  "evidence": {
    "test": "e2e/checkout-mobile.spec.ts",
    "run_id": "...",
    "screenshots": ["before.png", "after.png"],
    "console_errors": 0,
    "network_failures": 0
  }
}
```

OpenAI описывает end-to-end flow, где agent воспроизводит bug, записывает видео, исправляет его, снова проверяет приложение и предоставляет evidence перед PR. citeturn13view0

## Model portfolio, context, tools, security и durable execution

Не существует осмысленного ответа «какая модель лучшая для coding». В harness важнее **portfolio**:

```text
task classifier
        │
        ├── high ambiguity / architecture ──► strongest reasoning model
        ├── normal implementation ─────────► workhorse coding model
        ├── mechanical edits ──────────────► cheap/fast model
        ├── independent review ────────────► strong skeptical model
        ├── browser / visual QA ───────────► multimodal/computer-use model
        └── deterministic operation ───────► NO MODEL
```

На **8 августа 2026 года** доступный frontier landscape уже отличается от начала года.

OpenAI 9 июля выпустила **GPT-5.6** в трёх tiers: **Sol** как flagship, **Terra** как lower-cost tier и **Luna** как fastest/most affordable tier; все три доступны через API и Codex. Такой tiering сам по себе иллюстрирует правильную harness abstraction: capability level должен быть configurable, а не hardcoded к одному model ID. citeturn13view1

Anthropic 24 июля выпустила **Claude Opus 5**, подчёркивая улучшения long-running multi-step work, verification и iterative behavior; **Claude Sonnet 5**, выпущенная 30 июня, позиционируется как более scalable agentic-coding model с длительным focus. Эти provider claims всё равно следует проверять на собственных tasks, а не считать универсальным ranking. citeturn13view2turn13view3

У Google на 21 июля 2026 года **Gemini 3.6 Flash** является актуальным fast agentic/multimodal model; current developer docs описывают его как баланс speed/intelligence для agentic и multimodal workloads и указывают native Computer Use. **Gemini 3.5 Flash-Lite** предназначен для high-throughput/low-cost execution. Важно: Google на эту дату всё ещё сообщала, что **Gemini 3.5 Pro проходит partner testing**, поэтому считать его broadly available production default по состоянию на 8 августа было бы неправильно. citeturn13view4turn13view5

Вместо ranking я бы начинал с такой hypothesis matrix:

| Role | Initial model class | Почему |
|---|---|---|
| Architecture / ambiguous planning | Opus 5 / GPT-5.6 Sol-class | максимальный reasoning/judgment budget |
| Difficult debugging/root cause | strongest model | стоимость failure высока |
| Everyday implementation | Sonnet 5 / GPT-5.6 Terra-class | better throughput-quality tradeoff |
| Mechanical change | GPT-5.6 Luna / Flash-Lite-class | не нужен maximal reasoning |
| Code review | strong model, ideally independent family/run | false negatives дороги |
| Test generation | workhorse; strong model для difficult invariants | легко проверяется executable tests |
| Repository research | workhorse + bounded parallelism | tool-heavy workload |
| Browser/UI QA | multimodal/computer-use capable model | visual state является частью evidence |
| Summarization/handoff | inexpensive reliable structured-output model | output schema легко проверяется |
| `git`, parsing, metadata, simple transforms | deterministic code | LLM вообще не нужен |

Но эта таблица — **prior**, а не answer.

Правильный model routing эксперимент:

```text
for task_class in benchmark:
    for model in candidate_models:
        run N repeated trials
        measure:
            success
            first-pass success
            wall time
            intervention count
            input/output tokens
            tool turns
            cost
            defects
            retry count

choose cheapest model satisfying quality SLO
```

Например:

```text
quality SLO:
    success_rate >= 0.92
    escaped_defect_rate <= 0.02

then minimize:
    expected_cost_per_success
```

а не «выбрать модель с самой большой benchmark цифрой».

GitHub уже использует похожую логику в Copilot routing: real-time health, utilization, speed, error rate и cost сочетаются с task-aware features вроде reasoning depth, code complexity, debugging difficulty и tool orchestration requirements. citeturn13view7

**Routing должен происходить не только между models, но и между model и deterministic software.** GitHub при оптимизации Agentic Workflows получила 62% reduction token metric в одном часто запускавшемся workflow, переместив deterministic data fetching из LLM turns в обычные pre-agentic CLI steps; в security workflow relevance gate вообще пропускал model call, если diff не затрагивал нужные файлы. citeturn18view1

Очень полезная engineering heuristic:

```text
Need creativity/judgment?
    yes -> model

Need uncertain diagnosis?
    yes -> model

Known transformation?
    -> code

Known lookup?
    -> API/CLI/database

Known validation?
    -> executable checker

Need language model only to decide whether model is needed?
    -> consider cheap classifier or deterministic gate
```

**Context engineering** в хорошем harness становится отдельным service:

```text
ContextBuilder(task):
    1. load task/spec
    2. load short repo map
    3. identify impacted domains
    4. retrieve targeted architecture docs
    5. activate relevant skills
    6. retrieve verified memories
    7. select minimal toolset
    8. attach current state/checkpoint
    9. impose context/token budget
```

Не пытайтесь автоматически класть весь repository в миллион-token context. Большой context window — capacity, не обязанность.

**Agent Skills** следует использовать для процедур, которые:

1. повторяются;
2. требуют специфического порядка действий;
3. имеют repository/team conventions;
4. могут быть проверены;
5. полезны более чем одной задаче.

Например:

```text
skills/
  investigate-ci-failure/
  verify-api-change/
  add-database-migration/
  run-browser-qa/
  review-security-sensitive-diff/
  create-release-note/
  verify-observability/
```

Плохой skill — энциклопедия на 15 тысяч строк. Хороший skill даёт короткий procedure и раскрывает deeper references только по мере необходимости. Это совпадает с progressive disclosure в Agent Skills standard. citeturn19view0

**MCP** полезен для portable tool boundary:

```text
issue_tracker.get_issue
github.create_pull_request
browser.capture_screenshot
observability.query_logs
deploy.get_status
```

Но внутри собственного harness я бы не боялся сочетать MCP с ordinary CLI/typed SDK calls. Protocol abstraction имеет смысл там, где portability и runtime discovery перевешивают schema/context overhead.

**Guardrails должны быть capability-based, а не prompt-based.**

Слабый guardrail:

```text
"Please never push to main."
```

Сильный guardrail:

```text
Git credential:
    repository = X
    branch prefix = agent/*
    force_push = false
    protected branches = denied
```

Anthropic cloud sandbox, например, держит sensitive git credentials вне agent sandbox и проводит git operations через scoped proxy; filesystem и network isolation используются одновременно. citeturn17view0

Полезно классифицировать actions:

| Capability | Default |
|---|---|
| read repository | allow |
| run tests/build | allow in sandbox |
| write task worktree | allow |
| install arbitrary software | restricted |
| public internet | allowlist |
| push agent branch | allow |
| create PR | allow |
| modify secrets | deny |
| production mutation | deny/strong gate |
| merge protected branch | policy/human gate |
| destructive DB action | deny unless specialized controlled workflow |

**Durable execution** для multi-hour agents требует separation между agent reasoning и workflow engine:

```text
Durable workflow state:
    task ID
    current stage
    attempt
    worktree/container ID
    model choice
    budget used
    artifacts
    commit SHA
    verification state
    review findings
    checkpoint
    retry deadline

Ephemeral model state:
    current prompt
    recent observations
    reasoning context
```

При crash вы восстанавливаете первое и создаёте новый agent context из checkpoint.

Retries тоже должны быть typed:

```text
RATE_LIMIT
    exponential backoff

MODEL_TRANSIENT_ERROR
    retry same episode

TOOL_TIMEOUT
    retry / increase tool timeout if allowed

TEST_FAILURE
    send to repair loop

POLICY_DENIAL
    do NOT blindly retry
    inspect capability / escalate

AMBIGUOUS_REQUIREMENT
    human escalation

REPEATED_SAME_FAILURE
    stop loop / escalate
```

Именно различение retryable и semantic failures отделяет durable execution от `while !done: run_agent()`.

## Evals, observability и benchmark прогресса

Это, вероятно, **самая важная часть вашего месячного перехода**. Без evals вы будете учиться строить впечатляющие demos, но не harnesses.

Anthropic предлагает очень полезную терминологию: **task** имеет inputs и success criteria; **trial** — один stochastic attempt; **grader** проверяет один аспект; **trace/trajectory** содержит model/tool interactions; **outcome** — реальное final state environment; eval harness запускает tasks, записывает runs и агрегирует оценки. Самое важное различие — agent может написать «задача выполнена», но outcome определяется состоянием environment. citeturn15view4

### Что именно измерять

Ваш базовый metrics schema должен выглядеть примерно так:

| Metric | Определение | Зачем |
|---|---|---|
| **Task success rate** | successful trials / all trials | Главный outcome |
| **First-pass success** | pass до repair/retry | Качество initial execution |
| **Autonomous success** | pass без human intervention | Настоящая autonomy |
| **Escaped defects** | дефекты после accepted/merged output | Не дать benchmark gaming заменить quality |
| **Review findings** | count × severity | Показывает latent quality |
| **Retry count** | retries per episode/task | Reliability/harness friction |
| **Repeated-failure rate** | одинаковая причина ≥2 раз | Loop pathology |
| **Wall-clock time** | start → verified completion | User-perceived throughput |
| **Human active time** | реальные минуты human attention | Главная scarce resource |
| **Human interventions** | число required interventions | Autonomy proxy |
| **Input/output/cache tokens** | per episode/task | Resource consumption |
| **Cost per task** | API + infrastructure | Economics |
| **Cost per successful task** | total cost / successes | Лучше raw cost |
| **Tool-call count** | по tool/category | Диагностика inefficient loops |
| **Model latency** | p50/p95 per call/episode | UX/throughput |
| **Regression rate** | раньше passing tasks, теперь failing | Harness stability |
| **Architectural violations** | structural/lint constraints | Architectural drift |
| **Verification coverage** | acceptance criteria backed by evidence | Prevent fake completion |
| **Escalation precision** | justified escalations / all escalations | Не строить агента, который постоянно просит помощи |

Я бы сделал **human active time** главным north-star metric наряду с quality. Именно human attention OpenAI обнаружила как новый bottleneck при управлении несколькими coding sessions. citeturn14view1

Но одна цифра опасна. Вместо «agent score = 87» стройте **Pareto frontier**:

```text
              higher quality
                   ▲
                   │       ● expensive strong workflow
                   │    ●
                   │ ●
                   └────────────────► lower cost / less human time
```

Например, multi-agent variant имеет смысл только тогда, когда его improvement находится на frontier, а не когда он стоит в 4 раза дороже ради 0.5% success improvement.

### Как построить собственный benchmark

Не начинайте с SWE-bench leaderboard. Создайте benchmark из **вашей собственной реальной engineering distribution**.

SWE-bench Verified полезен как methodological inspiration: issue + repository snapshot + hidden `FAIL_TO_PASS` tests + regression `PASS_TO_PASS` tests. SWE-Lancer полезен тем, что использует реальные freelance tasks и end-to-end graders. citeturn17view5turn17view4

Для каждой задачи сохраните:

```yaml
task_id: feature-07
repo_commit: abc123
issue: issue.md

visible:
  requirements: ...
  repo: ...

hidden:
  acceptance_tests: ...
  regression_tests: ...
  architectural_assertions: ...
  quality_review_rubric: ...

limits:
  max_wall_time: 45m
  max_cost: 5.00
  network_policy: ...
```

**Не показывайте агенту hidden graders.** Иначе вы измеряете способность написать код под конкретный test, а не решить issue.

Одинаковый repository snapshot обязателен. Anthropic в феврале 2026 года показала, что одна лишь infrastructure configuration способна менять agentic coding benchmark на несколько percentage points и даже превышать разрыв между top models. citeturn17view3

Поэтому experiment record должен включать:

```text
model + version
reasoning/effort setting
harness commit
prompt/skill versions
container image
CPU/RAM
network mode
timeout
tool versions
repository SHA
randomization / trial number
```

### Ваш набор одинаковых engineering tasks

Я рекомендую **18 задач**, каждая запускается из frozen repository state.

| ID | Категория | Задача | Что проверяет |
|---|---|---|---|
| T01 | Bug | неправильная boundary validation | local debugging |
| T02 | Bug | timezone/date edge case | hidden edge cases |
| T03 | Bug | cache invalidation error | multi-file reasoning |
| T04 | Bug | flaky asynchronous test | diagnosis under nondeterminism |
| T05 | Feature | добавить validated API endpoint | spec→implementation |
| T06 | Feature | pagination/filtering | API + compatibility |
| T07 | Feature | persisted user preference | frontend + backend |
| T08 | Feature | role-based permission | security constraints |
| T09 | UI | broken responsive checkout/form | visual/browser QA |
| T10 | UI | accessibility regression | semantic + browser verification |
| T11 | Refactor | extract module without behavior change | regression discipline |
| T12 | Refactor | replace deprecated library/API | repository-scale search |
| T13 | Architecture | eliminate forbidden dependency edge | invariant compliance |
| T14 | Database | backwards-compatible schema migration | operational reasoning |
| T15 | Testing | add missing regression tests for known bug | test quality |
| T16 | Performance | reduce known endpoint latency under threshold | observability/evidence |
| T17 | CI | diagnose and repair realistic CI failure | external feedback loop |
| T18 | Cross-cutting | feature requiring docs/config/code/tests | long-horizon coherence |

Подберите задачи так, чтобы примерно треть была easy, треть medium, треть hard. Часть задач должна быть deliberately ambiguous enough, чтобы правильным действием была **escalation**, иначе вы случайно обучите harness никогда не просить human judgment.

### Матрица экспериментов

Запускайте один и тот же suite через:

```text
A  Current baseline
   PRD → agent → human/AI review → testing

B  Autonomous single agent
   issue → agent → verifier

C  Spec-driven
   issue → spec → agent → verifier

D  Review/repair
   spec → implement → independent review → repair

E  Skills
   D + procedural skills

F  Model routing
   E + task/model routing

G  Orchestrated
   F + targeted subagents / parallelism

H  Full harness
   durable execution + worktrees + CI + evidence
```

Очень важно делать **ablation**, а не только cumulative comparison.

Например:

```text
review loop:
    ON vs OFF

skill:
    ON vs OFF

planner:
    ON vs OFF

multi-agent:
    1 vs 3 agents

routing:
    fixed strong model vs routed portfolio
```

Иначе вы никогда не узнаете, какая именно техника дала improvement.

Из-за stochastic output запускайте хотя бы **3 trials** на вариант/task; для важных conclusions — 5+. Anthropic также рекомендует multiple trials именно потому, что отдельные agent attempts варьируются. citeturn15view4

18 tasks × 3 trials × 7 configurations = 378 runs, что уже достаточно дорого. Поэтому в течение месяца используйте:

```text
development suite: 6 tasks
regression suite: 12 tasks
final suite: all 18
```

и периодически делайте full comparison.

### Что считать настоящим progress

Представим:

| Harness | Success | Autonomous | Human min/task | Cost/success | Wall time |
|---|---:|---:|---:|---:|---:|
| baseline | 83% | 0% | 24 | $1.80 | 32m |
| single agent | 67% | 67% | 4 | $2.10 | 18m |
| spec | 76% | 76% | 3 | $2.35 | 21m |
| review/repair | 87% | 84% | 3 | $3.40 | 30m |
| routed | 86% | 83% | 3 | $2.10 | 24m |
| multi-agent | 88% | 84% | 3 | $6.70 | 22m |

В таком гипотетическом результате model routing — большой engineering win, а multi-agent почти наверняка не оправдан. Именно так нужно мыслить.

### Tracing

Каждый task должен распадаться на **episodes**:

```text
spec
context acquisition
plan
implementation
test
repair
review
repair
browser QA
CI repair
delivery
```

Trace event:

```json
{
  "task_id": "T17",
  "episode": "ci-repair",
  "agent": "implementer",
  "model": "...",
  "attempt": 2,
  "tool": "shell",
  "duration_ms": 1883,
  "input_tokens": 4210,
  "output_tokens": 744,
  "result": "failed",
  "failure_class": "permission_denied"
}
```

Это позволяет отвечать не «этот agent дорогой», а:

> «32% cost потрачено на repeated repository discovery; 18% turns — redundant MCP reads; permission denial вызывает 2.8 retries/task».

GitHub уже применяет API-level token observability именно так и обнаружила unused MCP schemas, deterministic reads inside agent loops и runaway fallback loops. citeturn18view0turn18view2

### Autonomy — не duration

Не путайте «agent выполнялся шесть часов» с «agent способен решать six-hour human task». METR определяет time horizon через **человеческую продолжительность задачи при заданной вероятности успеха**, а не runtime самого агента, и прямо предупреждает об этом различии. citeturn17view6

В собственном harness лучше измерять:

```text
Autonomy =
    probability(task completes)
    under zero human intervention

conditioned on:
    task difficulty
    max cost
    max wall time
```

Это гораздо полезнее красивого «наш агент может работать всю ночь».

## Competency map и интенсивная программа на месяц

С учётом описанного вами текущего workflow вы уже явно не на уровне beginner AI-assisted development. Я бы оценил исходную позицию приблизительно как **уровень между assisted engineer и начинающим harness engineer**: вы умеете делегировать implementation/review/testing, но главный lifecycle, likely, всё ещё существует в вашей голове и interactive sessions.

### Шкала зрелости

| Уровень | Что способен построить | Workflow | Что делегирует | Что диагностирует | Что измеряет |
|---|---|---|---|---|---|
| **AI-assisted developer** | отдельные features с AI | human→agent→human | code, tests, review | prompt/code failures | почти ничего |
| **Autonomous-agent engineer** | single-agent issue→PR runner | task→agent loop→tests | полный bounded task | tool/context/test failures | pass rate, retries, cost |
| **Spec/context engineer** | repeatable agent workflow | spec→plan→execute→verify | medium scoped features | requirement/context degradation | success by task class |
| **AI-native / agentic engineer** | production harness | queue→agents→verification→PR | существенную часть SDLC | loop, state, policy, environment, eval failures | quality/autonomy/time/cost |
| **Harness/orchestration engineer** | multi-repo agent platform/software factory | durable control plane + model portfolio + eval infrastructure | portfolio of tasks | distributed lifecycle, drift, routing, reliability | system-level Pareto frontier |

**Что отличает последний уровень:** инженер уже не «умеет хорошо разговаривать с model». Он способен посмотреть на failure trace и сказать:

```text
This is not a model failure.

The agent correctly identified the required operation,
but our filesystem policy denies it.
That causes a fallback search loop.
We should fix the capability boundary and add
a regression eval for this failure class.
```

Или наоборот:

```text
Tooling is fine.
Context contains the relevant API contract.
Verifier correctly detects failure.
Across five trials two strong models still misreason
about this concurrency invariant.
This is likely a model-capability bottleneck.
```

Это огромная разница.

### Gap от вашего текущего workflow

Ваше описание:

```text
PRD
→ agent implementation
→ human/AI review
→ testing
```

уже содержит intent, implementation и verification, но обычно отсутствуют или не систематизированы следующие layers:

```text
PRD
  ↓
machine-readable acceptance criteria        ← gap
  ↓
versioned spec/plan state                   ← gap
  ↓
automatic task classification               ← gap
  ↓
model routing                               ← gap
  ↓
context builder / skills                    ← gap
  ↓
isolated durable workspace                  ← gap
  ↓
agent loop
  ↓
external deterministic verification
  ↓
structured reviewer                         ← partial
  ↓
bounded repair loop                         ← gap
  ↓
browser / operational evidence              ← gap
  ↓
CI auto-recovery                            ← gap
  ↓
trace + cost + intervention telemetry        ← major gap
  ↓
eval suite + ablations                      ← major gap
  ↓
systematic harness improvement              ← major gap
```

Следовательно, ваш месяц не стоит тратить главным образом на learning more prompting. Главная образовательная задача — **externalize the control loop into software**.

### Интенсивный тридцатидневный curriculum

Оптимальный daily split:

```text
~20–25% reading / architecture
~60–65% implementation
~15–20% experiments / eval analysis
```

То есть при 6–8 часах интенсивной работы — примерно 1–2 часа theory и 4–6 часов build/eval.

| Дни | Понять и прочитать | Построить | Эксперимент | Критерий освоения |
|---|---|---|---|---|
| **1–3** | Codex agent loop; OpenAI Harness Engineering; Anthropic eval vocabulary citeturn14view0turn15view4 | V0: CLI `issue → agent → diff → test` | 6 baseline tasks, traces | можете объяснить каждый transition и failure |
| **4–6** | context engineering; progressive disclosure citeturn15view3turn14view0 | repo map, `AGENTS.md`, architecture docs, ContextBuilder | full-context vs targeted context | меньше tokens без падения success |
| **7–9** | Spec Kit / executable specs citeturn15view5 | issue→spec→plan→acceptance pipeline | PRD-only vs spec-driven | measurable first-pass improvement |
| **10–12** | test-fix, review-repair, evaluator separation citeturn16view5 | verification engine + bounded repair | self-review vs independent reviewer | знаете marginal value reviewer |
| **13–15** | Agent Skills; MCP/tool economics citeturn19view0turn18view0 | 4–6 reusable skills; typed tools | instructions-inline vs skill | skill improves repeatability or is removed |
| **16–18** | sandboxing, permissions, worktrees citeturn17view0 | WorkspaceManager: worktree/container/ports | parallel two-task execution | no shared-state corruption |
| **19–21** | Anthropic long-running harnesses; Symphony lifecycle citeturn15view0turn14view1 | checkpoints, resume, retry taxonomy | kill process mid-task and recover | recovery works without human reconstructing state |
| **22–24** | model routing; infrastructure/eval noise citeturn13view7turn17view3 | model router + experiment runner | strong-only vs routed | optimize cost/success under fixed SLO |
| **25–27** | multi-agent research; distributed-agent failures citeturn16view3turn16view0 | reviewer subagent + optional fan-out | 1 vs 2 vs 4 agents | можете доказать, где multi-agent pays for itself |
| **28–30** | GitHub Agentic Workflows; production guardrails; tracing citeturn19view3turn18view1 | issue→PR→CI recovery→evidence dashboard | полный 18-task final benchmark | defend design with quantitative results |

**Дни 1–3: не используйте framework-heavy orchestration.** Напишите минимальный runner сами. Вы должны физически понять loop:

```python
while budget_left:
    response = model(context)
    if response.requests_tool:
        observation = execute_tool()
        context.append(observation)
    elif verifier_passes():
        finish()
    else:
        inject_failure()
```

Framework abstractions после этого будут понятны, а не магичны.

**Дни 4–6: сделайте repository agent-legible.** Создайте:

```text
AGENTS.md
ARCHITECTURE.md
docs/
  product/
  architecture/
  workflows/
  runbooks/
  exec-plans/
skills/
scripts/
  bootstrap
  test
  lint
  run-app
```

Затем дайте fresh agent три repository questions, на которые раньше требовался human onboarding. Если он не способен быстро найти authoritative answer, repo ещё illegible. OpenAI именно repository-local versioned knowledge считает foundation своей автономности. citeturn14view0

**Дни 7–9:** напишите свой mini Spec Kit, даже если позже будете использовать настоящий. Вы должны понимать transformation:

```text
request
→ requirement extraction
→ ambiguity classification
→ spec
→ architectural impact
→ acceptance cases
→ plan
```

Не разрешайте agent автоматически «уточнять» всё у человека. Он должен различать:

```text
resolvable from repository
inferable under safe default
requires product judgment
```

Только последняя категория должна escalate.

**Дни 10–12:** сделайте verifier главным authority. Введите `VerificationReport`:

```json
{
  "requirements": [
    {
      "id": "AC-3",
      "status": "pass",
      "grader": "browser-e2e",
      "evidence": "..."
    }
  ],
  "regressions": [],
  "architecture": "pass"
}
```

**Дни 13–15:** превращайте повторяющийся prompt knowledge в skills. Хороший mastery test: удалить procedural guidance из global prompt и доказать, что skill activation восстанавливает quality.

**Дни 16–18:** deliberately атакуйте свой harness:

```text
agent attempts ../secrets
agent opens unexpected network host
agent tries to push main
agent modifies unrelated worktree
agent installs dependency from arbitrary source
```

Цель — не попросить модель «не делать этого», а сделать запрещённые actions физически невозможными.

**Дни 19–21:** проведите chaos experiments:

```text
kill orchestrator
kill agent
timeout model call
return 500 from GitHub API
delete ephemeral process
inject flaky test
```

После restart task должен либо продолжиться, либо перейти в понятное typed failure state.

**Дни 22–24:** заморозьте task suite и начинайте настоящую eval discipline. Не изменяйте одновременно model, prompt, toolset и infrastructure.

**Дни 25–27:** multi-agent вводится только сейчас намеренно. До этого у вас уже есть baseline, чтобы доказать его пользу или бесполезность.

**Дни 28–30:** перестаньте добавлять features и стабилизируйте factory. Запустите полный benchmark, изучите top failure classes, удалите ненужную complexity и подготовьте архитектурный write-up.

На выходе месяца вашим главным artifact должен быть не GitHub repository с красивым agent demo, а:

```text
1. working harness
2. architecture document
3. eval dataset
4. benchmark report
5. traces
6. model-routing report
7. failure taxonomy
8. security model
9. cost/autonomy curves
10. retrospective: which "advanced" ideas did NOT help
```

Последний пункт особенно важен для уровня Founding Engineer.

## Capstone: mini software factory от issue до verified PR

Ваш capstone идеально подходит под все перечисленные компетенции. Я бы строил его не как «multi-agent framework», а как **measured software delivery system**.

Conceptual architecture:

```text
                         GitHub Issue
                              │
                              ▼
                     ┌────────────────┐
                     │ Intake Service │
                     └───────┬────────┘
                             ▼
                     Requirement Agent
                             │
                    ┌────────┴────────┐
                    │                 │
              resolvable          judgment?
                    │                 │
                    ▼                 ▼
                  Spec          Human escalation
                    │
                    ▼
              Planner / Task DAG
                    │
                    ▼
                 Router
          ┌─────────┼──────────┐
          ▼         ▼          ▼
      worktree A worktree B review workspace
          │         │
          ▼         ▼
       worker     worker
          └────┬────┘
               ▼
         integration
               │
               ▼
      deterministic verifier
               │
        fail ───┴──── pass
         │              │
         ▼              ▼
      repair       independent review
         ▲              │
         └──── fail ────┘
                        │ pass
                        ▼
                   Browser QA
                        │
                        ▼
                  Evidence pack
                        │
                        ▼
                     PR / CI
                        │
                  failure? ──► repair
                        │
                       pass
                        ▼
                      DONE
```

Снаружи каждого box:

```text
Durable state store
Trace/event store
Budget manager
Permission policy
Eval collector
```

### Эволюция harness

| Версия | Что добавить | Что намеренно пока НЕ делать | Measurement gate |
|---|---|---|---|
| **V0 — Runner** | issue→single agent→code→tests→diff | agents, memory, routing | task success + full trace |
| **V1 — Spec** | structured spec/acceptance/plan | parallelism | first-pass success improves |
| **V2 — Verify & repair** | graders, test-fix, review-repair, stop rules | deep multi-agent | autonomous success improves |
| **V3 — Agent-legible repo** | context builder, docs, skills, repo map | vector-memory complexity | lower tokens/retries |
| **V4 — Isolation** | worktree/container/app/browser per task | broad autonomous merge | safe parallel tasks |
| **V5 — Durable control plane** | queue, state, retry, checkpoint/resume | clever cognitive graphs | survives crash/restart |
| **V6 — Routing & specialization** | model router, reviewer, browser agent | arbitrary agent swarm | lower cost/success at same quality |
| **V7 — Delivery factory** | GitHub/CI handling, evidence, observability, dashboard | unsupervised high-risk prod actions | issue→verified PR mostly hands-off |

**V0** должен быть почти embarrassingly simple:

```text
load issue
create worktree
start coding agent
give repo tools
agent edits
run tests
save trace
report
```

Сделайте именно здесь baseline benchmark.

**V1** добавляет `spec.json` или Markdown contract:

```yaml
goal:
scope:
non_goals:
constraints:
acceptance:
verification:
ambiguities:
```

Хороший spec agent сначала исследует repository и только после этого решает, чего ему действительно не хватает.

**V2** — главный reliability jump.

Control loop:

```text
IMPLEMENT
   ↓
VERIFY ─ fail → REPAIR ──────┐
   │                         │
   pass                      │
   ▼                         │
REVIEW ─ findings → REPAIR ──┘
   │
   clean
   ▼
DONE
```

У loop обязательно есть:

```text
max attempts
max cost
max wall time
duplicate-failure detector
scope-growth detector
human escalation condition
```

**V3** превращает harness в knowledge system. Сделайте skills вроде:

```text
/reproduce-bug
/add-api-endpoint
/write-db-migration
/review-architecture
/run-browser-qa
/investigate-ci
```

Автоматически записывать любую agent observation в permanent memory не следует. Persist только high-value facts, а при retrieval проверяйте их against current repository, по аналогии с JIT verification GitHub. citeturn18view3

**V4** — первый реальный parallelism. Каждый task:

```text
task
→ worktree
→ environment namespace
→ DB namespace
→ port allocation
→ observability namespace
```

Теперь можно безопасно выполнить два independent issues параллельно.

**V5** отделяет orchestrator от agent process.

State:

```text
task_id
issue_revision
spec_version
workflow_state
workspace
current_commit
episodes
attempts
cost_budget
deadline
verification
review
CI
```

После kill -9 orchestrator вы должны иметь возможность выполнить:

```text
harness resume TASK-123
```

и не потерять прогресс.

**V6 — только здесь multi-agent.**

Начните с одного дополнительного reviewer:

```text
implementer:
    sees repo + spec + current state

reviewer:
    sees clean spec + diff + tests + architecture
    DOES NOT see implementer's justifications
```

Это уменьшает correlated confirmation bias.

Затем разрешите bounded fan-out для repository investigation:

```text
impact analysis:
  agent A → backend
  agent B → frontend
  agent C → database
```

Fan-in обязан возвращаться в structured schema.

Не позволяйте свободной agent-to-agent переписке становиться state store.

**V7** подключает GitHub lifecycle:

```text
GitHub issue
→ label agent-ready
→ factory starts
→ agent branch
→ PR draft
→ verification evidence attached
→ CI
   ├─ deterministic failure → repair
   ├─ infra/transient → retry
   └─ ambiguous policy → escalation
→ reviewer
→ ready-for-human-judgment OR auto-merge policy
```

Для low-risk tasks можно постепенно уменьшать human gate. Для database/security/production-affecting changes gate остаётся.

### Что считается «done»

Агент **никогда** не должен быть authority on completion.

```text
done =
    requirements resolved
AND acceptance graders pass
AND regression suite passes
AND architecture/security invariants pass
AND required review findings resolved
AND CI passes
AND required evidence exists
AND no unresolved high-severity finding
```

Не:

```text
done = model emitted "looks good"
```

Anthropic именно outcome/environment state использует как distinction from agent claim в eval methodology. citeturn15view4

### Как предотвращать architectural drift

OpenAI обнаружила, что agents копируют существующие patterns, включая плохие, поэтому entropy со временем накапливается. Их ответ — mechanical architecture boundaries, custom lints, structural tests и recurring cleanup work; раньше humans тратили значительную часть времени на cleanup, что не масштабировалось. citeturn14view0

В capstone сделайте:

```text
architecture tests
dependency-direction linter
schema conventions
module ownership
file-size limits
public API boundaries
logging requirements
migration rules
```

И, что особенно умно в подходе OpenAI, **error messages должны быть agent-repairable**:

```text
BAD:
ARCH001 failed

GOOD:
ARCH001:
UI cannot import Repository layer directly.
Allowed path: UI -> Runtime -> Service -> Repository.
Move database access behind OrdersService.
```

Линтер становится feedback tool.

### Evals как self-improvement loop

Ваша factory должна постоянно превращать production failures в regression tasks:

```text
agent fails real issue
        ↓
human identifies root cause
        ↓
classify:
  model?
  context?
  tool?
  policy?
  spec?
  verifier?
        ↓
add benchmark task
        ↓
change harness
        ↓
rerun
        ↓
keep change only if measured improvement
```

Это и есть настоящая «самоулучшающаяся agent system» в engineering sense. Не модель переписывает себя бесконтрольно — **ваша empirical feedback loop постепенно улучшает environment, tools и policies**.

## Что должен уметь AI Founding Engineer и как проходить архитектурное интервью

Сильный кандидат на AI Founding Engineer / Agentic Engineer в 2026 году должен звучать не как эксперт по конкретному CLI, а как инженер, который видит agent system одновременно как **distributed system, developer platform, probabilistic component и control system**.

### «Как бы ты построил harness для coding agents?»

Сильная структура мышления:

```text
1. Define task distribution.
2. Define observable outcomes.
3. Make repository executable and legible.
4. Give minimal tools/capabilities.
5. Isolate execution.
6. Build one simple agent loop.
7. Add deterministic verification.
8. Persist workflow state.
9. Add bounded repair.
10. Instrument every episode.
11. Build eval suite.
12. Only then add routing/subagents/parallelism.
```

Главный principle:

> **Start with the smallest harness capable of closing the feedback loop; add complexity only against measured failure modes.**

Это согласуется и с OpenAI, где missing harness capabilities обнаруживались через failures, и с Anthropic, где harness design изменял long-running outcome. citeturn14view0turn15view1

### «Когда нужен multi-agent, а когда нет?»

Не отвечайте «когда задача сложная».

Сложность сама по себе не является аргументом.

Нужен, когда:

```text
parallelizable independent search/work
separate context is valuable
independent judgment is valuable
tool specialization matters
expected benefit > coordination/cost penalty
```

Не нужен, когда:

```text
shared mutable state dominates
task is sequential
context must be shared exactly
deterministic verifier + one agent already solves reliably
extra agents mostly restate each other
```

Anthropic сама подчёркивает меньшую parallelizability большинства coding tasks относительно research; GitHub рекомендует относиться к multi-agent как к distributed systems с explicit boundaries и partial failures. citeturn16view4turn16view0

### «Как организовать feedback loop?»

Правильный порядок сигналов:

```text
external state
> deterministic test
> structural invariant
> independent evaluator
> self-critique
```

Feedback должен быть:

```text
specific
localizable
machine-readable where possible
actionable
bounded
```

Не просто:

> «tests failed».

А:

```json
{
  "grader": "checkout_e2e",
  "failure": "expected /success, got /cart",
  "step": "submit payment",
  "console_errors": [],
  "artifact": "trace.zip"
}
```

### «Как выбирать models?»

Ответ — не названия моделей.

Принцип:

> **Empirically route by task class to the cheapest model that satisfies the required quality SLO.**

Измеряйте success, first-pass, retries, cost/success, wall-clock и intervention rate. Учитывайте runtime health и availability. Такой task-aware + operational routing уже применяется GitHub. citeturn13view7

### «Как агент понимает, что задача закончена?»

Он не должен это определять один.

Completion — predicate над external environment:

```text
acceptance
∧ regressions
∧ invariants
∧ required review
∧ CI
∧ evidence
```

Agent может **предложить transition** в DONE. Harness принимает или отвергает его.

### «Как бороться с context degradation?»

Ответ должен содержать несколько levels:

```text
prevent:
    progressive disclosure
    targeted retrieval
    small toolsets

externalize:
    plans
    git
    progress artifacts
    repository docs

compress:
    structured summaries

reset:
    fresh context + handoff

verify:
    don't trust stale memory
```

Anthropic показала практическую пользу explicit resets и structured handoffs в long-running coding; OpenAI использует repo-local plans/docs как durable system of record. citeturn16view5turn14view0

### «Как измерять agent performance?»

Сначала:

```text
outcome quality
```

потом:

```text
autonomy
human attention
wall time
cost
retries
defects
```

Не token count в isolation.

А затем repeated trials + frozen infrastructure + ablations. Infrastructure noise в agent benchmarks достаточно велик, чтобы без такого контроля неправильный harness/model победитель выглядел статистически убедительно. citeturn17view3

### «Как дать агенту работать несколько часов автономно?»

Не ответ «большой context».

Нужны:

```text
isolated durable environment
persistent workflow state
small incremental commits
progress/checkpoint artifacts
context reset/handoff
tool timeout semantics
retry/backoff
budget limits
watchdog
external verification
human escalation path
```

Anthropic long-running experiments и OpenAI six-hour Codex runs показывают именно сочетание environment + durable artifacts + verification, а не одну чудесную модель. citeturn15view0turn14view0

### «Как предотвращать architectural drift?»

Правильная мысль:

> **Move architecture from prose into executable constraints.**

Например:

```text
dependency graph rules
API boundaries
schema validators
architecture tests
custom linters
review rubrics
tech-debt scanners
```

И используйте failures для обновления этих constraints. OpenAI именно так реагировала на entropy в fully agent-generated repository. citeturn14view0

### «Как сделать repository agent-legible?»

Хороший repository для agent похож на хороший repository для нового senior engineer, только constraints должны быть более explicit:

```text
short AGENTS.md map
clear architecture
single-command bootstrap
single-command tests
predictable paths
repository-local product context
versioned decisions/plans
typed boundaries
discoverable skills
queryable logs
browser-visible app
repairable linter errors
```

Принцип OpenAI очень точен: с точки зрения running agent то, что он не может обнаружить и прочитать в available context, фактически не существует. citeturn14view0

### «Что делать, если agent repeatedly fails?»

Хороший candidate не сразу меняет prompt/model.

Failure taxonomy:

```text
MODEL
    cannot reason correctly

CONTEXT
    necessary fact absent/stale

SPEC
    objective ambiguous

TOOL
    required capability missing/poor interface

ENVIRONMENT
    cannot reproduce/run system

POLICY
    legitimate operation blocked

VERIFIER
    wrong/weak success signal

ORCHESTRATION
    bad state/retry/handoff

RESOURCE
    timeout/token/cost/CPU
```

Затем change **one layer**, rerun eval и compare.

### «Когда spec-driven development мешает?»

Когда:

```text
task is tiny and obvious
spec creation costs more than execution
requirements are inherently exploratory
spec becomes fictional upfront certainty
agent mechanically follows obsolete plan
```

SDD нужен не ради документов, а ради **intent preservation и verifiability**.

### «Что важнее: model или harness?»

Правильный nuanced answer:

> На frontier оба являются multiplicative factors. Слабую модель harness не превратит в сильную. Но сильная модель в illegible, untestable, permission-broken environment тоже будет ненадёжна.

Это буквально следует из современных eval definitions: оценивается **model+harness combination**. citeturn15view4

А ещё harness assumptions могут устаревать по мере роста моделей. Следовательно, хороший harness не должен компенсировать каждую историческую model weakness тоннами hardcoded choreography. Он должен быть **минимальным, observable и removable**.

### «Как понять, что пора добавить агента?»

Очень сильный ответ:

> Я добавляю нового agent role только после того, как trace/evals показывают failure mode, который требует independent context, independent judgment или true parallel execution. Потом делаю ablation single-agent vs multi-agent и оставляю pattern только при improvement на quality/autonomy/cost frontier.

Это показывает, что вы мыслите как engineer, а не как enthusiast.

### «Как бы выглядела production-ready agentic software factory?»

Сильная final formulation:

```text
Human owns:
    intent
    architecture
    policy
    priorities
    exception judgment

Orchestrator owns:
    lifecycle
    state
    concurrency
    budgets
    retries
    routing

Agents own:
    uncertain reasoning
    implementation
    investigation
    repair

Deterministic systems own:
    build
    tests
    invariant checks
    data transforms
    policy enforcement

Environment owns:
    isolation
    reproducibility
    capabilities

Evals own:
    truth about whether the system improved
```

Именно это — центральный competency shift между обычным AI-assisted developer и сильным **AI-native / agentic / harness engineer**.

Ваш target после месяца реалистично не должен быть «я построил полностью автономного virtual engineering department». Гораздо более сильный результат:

> **Я могу взять реальный engineering task distribution, построить для него isolated and durable coding-agent harness, выразить intent и architecture как executable constraints, предоставить агентам appropriate tools/context/skills, организовать verification/repair/delivery loops, измерить success/autonomy/human-time/cost на reproducible benchmark, диагностировать failures по слоям системы и экспериментально доказать, где routing, memory, reviewer или multi-agent orchestration действительно улучшают результат.**

Это уже очень близко к сути современной роли AI Founding Engineer.

И, пожалуй, самая важная frontier-эвристика на август 2026 года:

> **Не автоматизируйте человека. Автоматизируйте feedback loop.**

OpenAI добилась наиболее интересного результата не потому, что человек перестал существовать в процессе, а потому, что человеческий judgment постепенно переводился в acceptance criteria, repository knowledge, architectural invariants, tools, tests и recurring feedback mechanisms. При этом сама команда подчёркивает, что долгосрочная coherence полностью agent-generated codebase всё ещё является открытым вопросом. citeturn14view0

Именно поэтому зрелость agentic engineer определяется не количеством запущенных agents, а способностью ответить на пять вопросов:

**Что агент должен сделать? Как он получает правильный контекст и capabilities? Какая внешняя система докажет, что он сделал это правильно? Что произойдёт при failure? И какие данные покажут, что следующая версия harness действительно стала лучше?**