---
id: task-kota-status-command
title: Add kota status command for a quick operational overview
status: done
priority: p3
area: cli
summary: Operators must run kota workflow list, kota approval list, and kota session list separately to understand the current system state. A single kota status command would give a quick dashboard-style overview combining daemon connectivity, active runs, pending approvals, and today's cost.
created_at: 2026-03-31T17:30:00Z
updated_at: 2026-03-31T17:52:00Z
---

## Problem

Checking whether KOTA is healthy requires running several commands: `kota doctor` for
configuration health, `kota workflow list --status active` for active runs,
`kota approval list` for pending approvals, and `kota session list` for interactive
sessions. `kota doctor` covers config integrity but says nothing about live operational
state. There is no one-liner that answers "is everything OK right now?"

## Desired Outcome

A `kota status` command that outputs a concise operational snapshot:

```
Daemon:     running  (pid 12345, uptime 2h 14m)
Runs:       2 active, 0 queued
Sessions:   1 interactive
Approvals:  1 pending  ← requires attention
Budget:     $0.42 of $5.00 today
```

When the daemon is not running, it reports that fact and exits without error.
When approvals are pending, it exits with code 1 so scripts can act on it.

The command reads from the daemon control API when available and falls back to
on-disk state (`.kota/`) when the daemon is offline.

## Constraints

- Read-only; does not change any state.
- Must work when the daemon is not running (falls back to on-disk reads).
- Follow the pattern of `kota doctor` for daemon connectivity checks.
- Exit code 0 when no attention is needed; exit code 1 when approvals are pending.
- Keep implementation under ~150 lines; this is a display command, not a new subsystem.
- Do not duplicate logic from `kota doctor`; focus on operational state, not config health.

## Done When

- `kota status` prints daemon connectivity, active run count, session count, pending
  approval count, and today's cost in a readable format.
- Exit code 1 when one or more approvals are pending.
- Works offline (daemon not running) without crashing.
- At least a basic unit test covers the output formatting logic.
