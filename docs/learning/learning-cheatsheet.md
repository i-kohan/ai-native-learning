# AI-Native Learning — Cheat Sheet

## Source of truth

Only GitHub stores permanent project state:

```text
i-kohan/ai-native-learning / main
```

Core docs:

```text
docs/learning/master-learning-plan.md
docs/learning/learning-process.md
docs/learning/learning-cheatsheet.md
docs/learning/deep-research-report.md
docs/learning/progress.md
docs/learning/experiments.md
```

ChatGPT Project stores chats, not duplicate permanent docs.

## Main loop

```text
Master → Topic Chat → Cursor → Topic Chat → GitHub → Master
```

### Master

- read current `master-learning-plan.md` + `progress.md` from GitHub;
- inspect experiments/architecture/code when needed;
- choose one next module;
- give a ready-to-copy Topic prompt with progress, harness state, roadmap position, why now, learning goals, practical outcome, scope/non-goals, relevant repo paths.

### Topic Chat

1. Understand.
2. Connect to current harness.
3. Split **learning-critical** vs **delegatable** implementation.
4. Define experiment.
5. Produce Cursor Task.
6. Review results and understanding.

### Cursor

1. Read current repo state.
2. Show short implementation plan.
3. Implement minimal scope.
4. Run tests/checks.
5. Run experiment.
6. Give 3–5-file/function code tour.
7. Update `progress.md` and `experiments.md`.
8. After module review/closure: commit + push.

## Simple Git flow

Until Worktrees / Isolation:

```text
module → implementation → tests/experiment → review/understanding → progress update → commit → push
```

No worktrees / complex branching / parallel development early.

## Module done when

- problem understood;
- mechanism understood;
- key execution flow explainable;
- implementation works;
- learning-critical code inspected;
- verification/experiment completed;
- failure modes understood;
- trade-offs understood;
- know when not to use it.

## Durable decisions

If a chat produces a decision that matters later, write it into the appropriate repo document. Do not rely on chat history as project state.
