---
id: task-task-gc-command
title: Add kota task gc command to archive terminal tasks
status: done
priority: p3
area: cli
summary: The tasks/done/ and tasks/dropped/ directories grow without bound as the autonomous loop runs. A gc command would let operators archive or prune old terminal tasks to keep the queue directory manageable.
created_at: 2026-03-31T05:01:00Z
updated_at: 2026-03-31T05:28:00Z
---

## Problem

Every task the builder or explorer moves to `done/` or `dropped/` stays on disk
permanently. There is no parallel to `kota workflow gc` for the task store. After
many autonomous cycles, `tasks/done/` fills with dozens of files, making it harder
to scan the directory and slower for explorer to grep for recent work.

`kota workflow gc` already demonstrates the pattern: an archival subcommand that
removes or compresses old terminal records based on age or count.

## Desired Outcome

`kota task gc` archives (moves) terminal tasks (`done`, `dropped`) older than a
configurable threshold to a `.kota/task-archive/` directory, or deletes them
outright when `--delete` is passed. Default behavior keeps the last N days of
terminal tasks (configurable, default 30 days) and archives the rest.

Options:
- `--days <n>` — archive tasks older than n days (default 30)
- `--delete` — permanently delete instead of archiving to `.kota/task-archive/`
- `--dry-run` — print what would be archived without doing it

## Constraints

- Only terminal states (`done`, `dropped`) are eligible; `ready`, `backlog`, `doing`,
  `blocked`, and `inbox` are never touched.
- The command should parse `updated_at` from task frontmatter to determine age.
- Default is archive (move), not delete; operators must opt into deletion.
- Output a summary of how many tasks were archived/deleted.
- Register in `src/task-cli.ts` alongside existing `kota task` subcommands.

## Done When

- `kota task gc` moves old done/dropped tasks to `.kota/task-archive/` by default.
- `--delete` flag removes them permanently instead.
- `--dry-run` prints the plan without mutating anything.
- At least one test covers the gc logic (age filtering + move behavior).
