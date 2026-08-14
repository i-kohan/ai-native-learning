# Lessons

Короткие учебные артефакты по каждому модулю. Их задача — быстро восстановить тему без повторного чтения больших research/roadmap docs.

Это не заменяет `progress.md` и `experiments.md`: они остаются source of truth для process/state/evidence.

Для каждого модуля:

```text
docs/learning/lessons/NN-short-name/
  theory.md   # 3–5 minute theory recap
  notes.md    # личные выводы, нюансы implementation и результаты
  traces/     # optional: representative runs/evidence
```

## `theory.md`

Должен быть коротким и содержать только самое важное:

- core mental model / definitions;
- mechanism / execution flow;
- important boundaries;
- main failure modes / trade-offs;
- 2–4 concrete observations from our implementation/experiments that confirm, challenge, or qualify the theory;
- 3–6 takeaways to remember.

Не превращать в учебник и не дублировать большие документы.

## `notes.md`

Практический журнал модуля: что построили, что увидели, неожиданные нюансы, команды, конкретные результаты и personal takeaways.

## Как использовать

- Нужно быстро вспомнить концепцию → `theory.md`.
- Нужно вспомнить, что именно происходило в нашем capstone → `notes.md` / representative traces.
- Нужно принять roadmap/process decision → `progress.md`, `experiments.md`, master/process docs.
