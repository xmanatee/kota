---
id: task-approval-batch-approve
title: Add kota approval approve-all command for batch approving pending tool calls
status: backlog
priority: p3
area: cli
summary: The approval CLI only supports approving one pending tool call at a time by ID. When a workflow accumulates multiple pending approvals (e.g. during a long agent run), operators must approve each one individually. A batch-approve command would reduce friction during high-throughput builder sessions.
created_at: 2026-04-02T08:20:00Z
updated_at: 2026-04-02T08:20:00Z
---

## Problem

`kota approval approve <id>` resolves a single pending item. Operators who walk away
from the terminal and return to find several queued approvals must run the command
multiple times in a row. There is no `approve-all` shortcut.

During active builder runs with guardrails enabled, this pattern is common: a single
task may generate 3–5 approval requests for file writes, shell commands, or git
operations.

## Desired Outcome

`kota approval approve-all [--note <text>]` approves all currently pending items in
a single command. The command:

1. Lists the pending items it is about to approve (tool name, risk, reason).
2. Prompts for confirmation unless `--yes` / `-y` is passed.
3. Approves each item in sequence and prints a summary line per item.
4. Exits with an error count if any individual approval fails.

An optional `--risk <level>` filter allows scoping to a subset (e.g., approve only
`low`-risk items automatically while leaving `high`-risk items pending).

## Constraints

- No changes to the approval queue data model or daemon API.
- Sequentially execute approved items (same behavior as individual `approve`); do not
  add parallelism in this task.
- Confirmation prompt must be bypassable with `--yes` for scripted use.
- The command must be idempotent if the queue empties between the list fetch and the
  approval loop (skip missing items gracefully).

## Done When

- `kota approval approve-all` is available and documented in `--help`.
- Displays pending items and prompts for confirmation unless `--yes` is passed.
- `--note` attaches the same note to every approved item.
- `--risk <level>` filters to only items of that risk level.
- Summary line printed after each approval; final count reported.
- Unit test covers the multi-item approval loop and empty-queue edge case.
