---
id: task-session-cli
title: Add kota session CLI commands for operator visibility
status: ready
priority: p3
area: cli
summary: Active sessions are tracked by the daemon and exposed via GET /status, but there are no CLI commands for operators to inspect or list them without querying the API directly.
created_at: 2026-03-30T19:57:00Z
updated_at: 2026-03-30T19:57:00Z
---

## Problem

When the daemon is running, active sessions (interactive CLI sessions and workflow
agent sessions) are visible via `GET /status` in the control API. There is no `kota session`
CLI for operators to list or inspect these sessions without writing raw HTTP requests.
The `kota task`, `kota approval`, and `kota workflow` commands follow a consistent pattern;
sessions have no equivalent operator surface.

## Desired Outcome

`kota session list` — lists all active sessions visible to the daemon, showing session ID,
type (interactive / workflow), agent name, and start time. When the daemon is offline,
falls back gracefully with a clear message.

`kota session inspect <id>` — shows full detail for a single session: id, type, agent,
model, start time, current step count, and working memory summary if available.

Both commands support `--json` for scripting.

## Constraints

- Query daemon control API (`GET /status`) when the daemon is running; follow the
  existing client pattern used by `kota workflow list`.
- Follow the `registerMemoryCommands` / `registerTaskCommands` registration pattern in
  `src/`. Place implementation in a new `src/session-cli.ts` and register in `src/cli.ts`.
- Read scope only — no add/remove/interrupt in this task.
- `kota session --help` must show both subcommands.

## Done When

- `kota session list` outputs active sessions or a clear offline message.
- `kota session inspect <id>` outputs session detail or a not-found error.
- Both commands support `--json`.
- All existing tests pass; new commands appear in `kota --help`.
- `src/AGENTS.md` updated to note `session-cli.ts`.
