# 08 — Worktrees / Isolation

## Коротко

**Isolation** в agentic coding harness означает: один task/run не должен случайно видеть или изменять mutable state другого task/run.

Для нашего harness главный mutable state сейчас — файлы repository, которые агент читает и меняет.

```text
Task A → Workspace A → source A
Task B → Workspace B → source B
```

Изменения A не должны появляться в B или в shared main checkout до явной интеграции результатов.

## Branch и worktree — не одно и то же

Git branch — это логическая линия истории / указатель на commit. Сам по себе новый branch не создаёт второй набор рабочих файлов.

В одном обычном checkout:

```text
working directory
+ HEAD
+ index
```

Чтобы работать с другой branch, обычно нужно переключить этот же working directory.

Git worktree создаёт дополнительный working tree:

```text
main checkout/

.worktrees/task-A/

.worktrees/task-B/
```

У A и B физически отдельные working files, HEAD и index, но они используют общий Git object database/history.

Поэтому A и B могут независимо менять один и тот же логический файл. Git conflict возникает не во время этих независимых edits, а позже, когда несовместимые изменения пытаются совместить через merge/rebase/cherry-pick.

## Exact base revision

Для воспроизводимости workspace должен быть привязан не просто к движущемуся `main`, а к конкретному commit SHA.

```text
C0 = e5d77788...

Workspace A @ C0
Workspace B @ C0
```

Если `main` позже сдвинется на C1, это не меняет факт, что оба run стартовали из C0.

Это даёт понятный provenance:

```text
run
→ exact base SHA
→ workspace
→ diff/result
```

Dirty uncommitted host changes в такой workspace не попадают: worktree создаётся из committed tree выбранного SHA.

## Task identity ≠ Workspace identity

Task — это работа, которую нужно выполнить.

Workspace — конкретное execution environment для одного run этой работы.

Один task может быть запущен несколько раз:

```text
Task T01
├─ run-1 → workspace-1
└─ run-2 → workspace-2
```

Поэтому workspace identity полезно хранить отдельно вместе с `baseRevision` и root path.

## Наша минимальная abstraction

В Module 08 появился `Workspace`:

```text
Workspace
├─ id
├─ root
├─ baseRevision
└─ ref
```

И boundary:

```text
createWorkspace
→ bindConfig
→ existing V3
→ cleanupWorkspace
```

`bindConfig` превращает workspace root в мир конкретного run:

```text
workspace.root
→ repoRoot
→ targetAppRoot
→ targetSrcRoot
```

Это ключевой design point: isolation добавлен **перед V3**, а не размазан по spec, implementation, repair, review и verifier.

## Почему existing V3 почти не пришлось менять

Ранее tools/verifier/context/snapshots уже получали paths через `HarnessConfig`.

Поэтому после binding:

```text
write_file → workspace targetSrcRoot
read_file  → workspace targetAppRoot
VERIFY     → npm test cwd=workspace targetAppRoot
context    → workspace repository state
snapshots  → workspace targetSrcRoot
```

Подсистемам не нужно знать, как был создан worktree. Они просто работают относительно переданных roots.

Это хороший пример полезной dependency injection: lifecycle принадлежит harness, а downstream-компоненты получают конкретное execution root.

## Lifecycle

Workspace isolation — это не только `git worktree add`.

Минимальный lifecycle:

```text
resolve base
→ create workspace
→ bind run
→ use
→ verify/review
→ collect durable evidence
→ cleanup or retain
```

В нашей версии normal path заканчивается cleanup.

Cleanup сделан retry-safe: повторный вызов не должен ломать систему, если desired state «workspace отсутствует» уже достигнут.

Crash recovery, TTL, leases и background garbage collection пока не нужны — это более поздняя orchestration проблема.

## Durable evidence отдельно от ephemeral workspace

Source state живёт в временном worktree, но traces/evals остаются на host checkout.

```text
.worktrees/run-A/      ← temporary execution state
traces/run-A.jsonl    ← durable evidence
```

Иначе обычный cleanup удалял бы вместе с workspace и evidence, по которому мы хотим оценивать run.

При этом repository inputs, например Skills и benchmark files, читаются из workspace revision, чтобы execution был согласован со своим base SHA.

## Что worktree НЕ изолирует

Worktree даёт прежде всего filesystem/Git working-state isolation.

Он сам по себе не изолирует:

- процессы;
- TCP ports;
- environment variables;
- network;
- secrets;
- внешние databases/services;
- mutable caches;
- spawned child processes.

Например два worktree могут независимо иметь разные `src/`, но два `npm start` всё равно могут попытаться занять один `3000` port.

В нашем harness это пока не нужно решать, потому что текущий experiment требует source isolation, а не полноценного environment orchestrator.

## Isolation ≠ Security ≠ Sandbox

Эти понятия нельзя смешивать.

**Isolation:**

> Task A и B случайно делят mutable state?

**Security:**

> Что агенту вообще разрешено читать, менять, запускать и куда ходить?

**Sandbox:**

> Технический containment mechanism, который может обеспечивать части isolation и security.

Git worktree не мешает процессу читать `~/.ssh`, ходить в сеть или обращаться к файлам вне workspace, если остальные boundaries это позволяют.

Поэтому:

```text
worktree ≠ sandbox
worktree ≠ security boundary
```

Security fundamentals — следующий отдельный слой.

## ISO01 — как правильно доказать isolation

Мы не запускали двух LLM agents только ради демонстрации параллельности.

Вместо этого сделали deterministic mechanism probe:

```text
C0
├─ Workspace A
└─ Workspace B

mutate only A: getTask 404 → 500

A    → mutation present
B    → mutation absent
main → unchanged

VERIFY(A) → FAIL (500 !== 404)
VERIFY(B) → PASS

cleanup A/B
cleanup retry → safe
```

Это лучше, чем просто проверить разные `cwd`: observable verifier outcome доказывает, что verification действительно bound к нужному workspace.

## Mechanism evidence ≠ capability metric

ISO01 не проверяет, насколько хорошо LLM решает coding tasks.

Поэтому результаты разделены:

```text
Capability / Regression
T01–T04

Mechanism probes
R01 / REV01

Isolation
ISO01
```

ISO01 не добавляется в first-pass denominator и не превращает `6/6 fixed contracts` в искусственное `7/7`.

Это продолжает правило Module 06: controlled mechanism probes нельзя молча смешивать с representative capability metrics.

## Что доказал Module 08

Experiment поддержал узкую гипотезу:

> Per-run Git worktree от exact base SHA может дать независимый mutable source state и привязать существующий V3 tools/verifier к конкретному workspace без изменения его основного lifecycle.

Fresh evidence:

```text
ISO01 workspace isolation    PASS
A/B same exact base SHA      yes
A mutation isolated from B   yes
main checkout unchanged      yes
verifier A / B               FAIL / PASS
cleanup / retry-safe         yes

T01–T04 expected outcomes    4 / 4
Executable first-pass        3 / 3
Correct escalation T04       1 / 1
R01 verification repair      PASS
REV01 independent review     PASS
All fixed V3 contracts       6 / 6
Hard regressions             none
```

## Known limits

1. `target-app/node_modules` сейчас symlink на host install: source isolated, dependency installation — нет.
2. Ручной `npm start` всё ещё использует main checkout; isolated execution интегрирован в benchmark/eval path.
3. Нет process/network/secret/DB isolation — это не было целью модуля.
4. Нет crash-recovery/TTL/leases — это понадобится только при более серьёзной concurrent/durable orchestration.

## Production lens

Наша версия:

```text
Task
→ exact commit
→ Git worktree
→ workspace-bound config
→ V3
→ host traces
→ cleanup
```

В крупной системе тот же principle может расшириться до полноценного per-task ephemeral environment:

```text
Task
→ immutable base image/snapshot + repo SHA
→ isolated filesystem
→ own processes / ports
→ scoped env + secrets
→ service/DB namespaces
→ run-specific logs/artifacts
→ execution
→ retain failed environment or cleanup
→ TTL / GC / ownership / leases
```

Такая инфраструктура появляется не потому, что «production должен быть сложным», а из конкретных failure modes: десятки concurrent tasks конфликтуют по процессам/ports/resources; untrusted execution требует security boundary; distributed workers требуют ownership/recovery.

Для нашего текущего harness worktree — достаточный минимальный precursor.

## Что важно запомнить

1. **Branch разделяет историю; worktree разделяет working state.**
2. **Exact SHA делает base воспроизводимым.** `main` может двигаться.
3. **Workspace — execution identity, не task identity.**
4. **Isolation лучше внедрять через root binding**, а не учить каждую фазу управлять worktree самостоятельно.
5. **Verifier обязан смотреть в тот же workspace, где были изменения.** Иначе isolation существует на диске, но harness проверяет не тот код.
6. **Lifecycle включает cleanup**, а не только create.
7. **Durable evidence можно хранить вне ephemeral workspace.**
8. **Worktree не изолирует процессы, ports, network, secrets или DB.**
9. **Isolation, Security и Sandbox — разные concepts.**
10. **Mechanism probe не является capability score.**
