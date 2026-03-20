---
id: task-kota-task-cli
title: Add kota task subcommand for queue inspection and management
status: ready
priority: p3
area: cli
summary: The task queue is managed entirely through file operations today. A kota task subcommand would let human operators inspect queue state, move tasks between states, and add inbox items without manually editing markdown files.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

Operators who want to inspect or adjust the task queue must navigate the `tasks/` directory and edit markdown files directly. There is no CLI interface for reading queue state, checking a specific task, or moving a task between states. This makes human oversight harder and error-prone (e.g., forgetting to update `status:` frontmatter or use `git mv`).

## Desired Outcome

- `kota task list [--state <state>]` — lists tasks in the given state (default: all open states) with id, priority, and title.
- `kota task show <id>` — displays full task content.
- `kota task move <id> <state>` — moves a task to the target state, updates `status:` frontmatter, and stages the rename atomically.
- `kota task add <title>` — creates a new inbox item from a title prompt.

## Constraints

- Read commands must not require the daemon to be running.
- Write commands should use `git mv` semantics under the hood to preserve git history.
- Do not duplicate the task format validation already in AGENTS.md; surface human-readable errors for malformed files.

## Done When

- `kota task list` outputs task state with id, priority, title.
- `kota task show <id>` prints the full task body.
- `kota task move <id> <state>` moves the file and patches the status field.
- Commands are tested at the CLI level.
