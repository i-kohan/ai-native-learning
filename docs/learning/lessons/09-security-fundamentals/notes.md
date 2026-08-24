# 09 — Security fundamentals

Практический журнал. Минимальный verification env allowlist + SEC01. Formal closure остаётся за Topic Chat / Master.

## Что это за урок одной фразой

Код, который исполняется через `npm test`, не должен наследовать harness/host secrets только потому, что они есть у parent process.

## Как устроено

```text
verificationChildEnv()  — positive allowlist
spawnNpmTest(cwd)       — один spawn для обоих путей

run_command("npm test")  ─┐
                           ├─ spawnNpmTest → allowlisted env
runFinalVerification()   ─┘
```

Retain classes:

- launch: `PATH` + Windows CreateProcess vars
- temp: `TMPDIR` / `TMP` / `TEMP`
- user dirs: `HOME` / Windows profile vars (npm/node defaults, not a filesystem sandbox)

Команды:

- `cd harness && npm test`
- `cd harness && npm run benchmark:sec01`
- `cd harness && npm run benchmark:iso01`
- `cd harness && npm run benchmark:eval`

## Файлы, которые стоит лично посмотреть

1. `harness/src/verify.ts` — allowlist, `verificationChildEnv`, `spawnNpmTest`
2. `harness/src/tools.ts` — `run_command` использует тот же spawn
3. `harness/src/sec01.ts` — ground truth, injection в `app.ts`, assertions
4. `harness/src/eval/aggregate.ts` + `report.ts` — SEC01 отдельно от 6/6
5. `traces/SEC01-secret-isolation-2026-08-24T12-49-32-810Z.json`

Поток SEC01: parent sentinel → worktree → inject probe → `runFinalVerification` → child не видит sentinel → cleanup.

## SEC01 ground truth (2026-08-24)

| Check                         | Result |
| ----------------------------- | ------ |
| parent contains `SEC01_SECRET` | yes    |
| probe source injected         | yes    |
| `SEC01_PROBE_EXECUTED`        | yes    |
| `SEC01_SECRET` visible to child | no   |
| verification                  | PASS   |
| sentinel absent from evidence | yes    |
| main checkout unchanged       | yes    |
| cleanup + retry               | yes    |

Это security/mechanism probe, не capability task и не sandbox proof.

## V3 regression (fixed-v3-m09)

```text
T01–T04 expected outcomes   4 / 4
Executable first-pass       3 / 3
Correct escalation T04      1 / 1
R01 verification repair     PASS
REV01 independent review    PASS
All fixed V3 contracts      6 / 6
ISO01                       PASS (Isolation, not 6/6)
SEC01                       PASS (Security, not 6/6)
Hard regressions            none
```

## Нюансы

- Старый `childEnvWithoutTestContext()` клонировал `process.env` и снимал только `NODE_TEST*`. Это чинило nested node:test, но пропускало секреты.
- Allowlist, не denylist: неизвестный `FOO_TOKEN` тоже не копируется.
- `HOME` оставлен, чтобы npm/node нашли default user dirs. Child по-прежнему может читать файлы через `fs`.
- Sentinel value не пишется в evidence; при случайном появлении redact + fail assertion.
- Worktree + scoped tools не дают filesystem/network/subprocess containment.

## Personal takeaways

- Direct tool boundary ≠ transitive execution boundary.
- Provenance (SHA/worktree) не заменяет authority (env).
- Mechanism probe должен доказать, что controlled code реально исполнился.
- SEC01 нельзя класть в capability 6/6.

## Topic Chat review

Pending. Implementation и evidence готовы к inspection; модуль не закрывать только потому, что тесты зелёные.
