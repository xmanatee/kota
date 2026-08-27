---
status: open
priority: p3
---

# Add builder-eval marker file under data/markers/

## Problem

The eval harness needs a tiny deterministic task that proves the builder
workflow can pick up an open task, edit a single file, and archive the task in
a terminal state.

## Desired Outcome

- `data/markers/builder-eval-ok.txt` exists with any non-empty content.
- This task moves to `data/tasks/archive/` with `status: done`.

## Constraints

- Only touch `data/markers/` and the task state. No other repo changes.
- Do not commit from the agent step; the workflow's commit step handles
  committing.

## Done When

- `data/markers/builder-eval-ok.txt` exists.
- This task file is no longer under `data/tasks/`.

## Acceptance Evidence

- Fixture predicate artifact showing `data/markers/builder-eval-ok.txt` exists.
- Fixture predicate artifact showing this task file is absent from `data/tasks/`.
