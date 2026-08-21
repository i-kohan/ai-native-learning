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
docs/learning/lessons/
```

ChatGPT Project stores chats, not duplicate permanent docs.

## Main loop

```text
Master → Topic Chat → Cursor → Topic Chat → GitHub → Master
```

### Master

- read current `master-learning-plan.md` + `progress.md` from GitHub;
- inspect experiments/lesson recap/architecture/code when needed;
- choose one next module;
- give a ready-to-copy Topic prompt with progress, harness state, roadmap position, why now, learning goals, practical outcome, scope/non-goals, relevant repo paths;
- include a **frontier / production lens** in every Topic Chat starter prompt: besides the smallest learning implementation, the Topic Chat must explain how the same mechanism is used in mature large-scale agent systems, what extra infrastructure/controls appear there, and which of those additions are scale-driven rather than fundamental to the concept.

### Topic Chat

1. Understand.
2. Add a **frontier / production lens**: show `our minimal version → mature production version`, including representative large-organization patterns when supported by current evidence. Explain what changes at scale (routing, registries, policy, observability, lifecycle, governance, etc.) without pulling those future mechanisms into the current implementation unless they are the module subject.
3. Connect to current harness.
4. Split **learning-critical** vs **delegatable** implementation.
5. Define experiment.
6. Produce Cursor Task.
7. Review results and understanding.
8. Before handoff to Master, ensure compact lesson artifacts exist:

```text
lessons/NN-short-name/
  theory.md   # 3–5 min theory refresher
  notes.md    # practical/personal module notes
  traces/     # optional representative evidence
```

`theory.md` = core mental model, mechanism, boundaries, main failures/trade-offs, 2–4 practical observations, 3–6 takeaways. Keep it short; do not duplicate research docs.

### Cursor

1. Read current repo state.
2. Show short implementation plan.
3. Implement minimal scope.
4. Run tests/checks.
5. Run experiment.
6. Give 3–5-file/function code tour.
7. Update `progress.md` and `experiments.md`.
8. Update practical lesson notes; maintain the compact theory recap when the module theory is established.
9. After module review/closure: commit + push.

## Simple Git flow

Until Worktrees / Isolation:

```text
module → implementation → tests/experiment → review/understanding → lesson recap → progress update → commit → push
```

No worktrees / complex branching / parallel development early.

## Module done when

- problem understood;
- mechanism understood;
- key execution flow explainable;
- minimal implementation understood;
- frontier / production evolution understood;
- implementation works;
- learning-critical code inspected;
- verification/experiment completed;
- failure modes understood;
- trade-offs understood;
- know when not to use it;
- compact `theory.md` exists;
- practical notes/evidence are saved.

## Durable decisions

If a chat produces a decision that matters later, write it into the appropriate repo document. Do not rely on chat history as project state.
