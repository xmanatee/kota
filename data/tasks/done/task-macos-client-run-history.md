---
id: task-macos-client-run-history
title: Add recent run history panel to macOS menu bar client
status: done
priority: p3
area: operator-ux
summary: The macOS menu bar client shows active runs and approvals but has no way to browse recent completed runs. A compact run history panel would let operators check build outcomes without switching to the web UI.
created_at: 2026-04-01T07:36:00Z
updated_at: 2026-04-01T07:36:00Z
---

## Problem

The macOS menu bar client (`clients/macos/`) surfaces active workflow runs and pending
approvals, but once a run completes it disappears from view. Operators must open the web
dashboard or run `kota workflow runs` in a terminal to see whether the last builder run
succeeded. For quick status checks this friction is high.

The daemon control API already exposes `GET /workflow/runs` with per-run status, duration,
and cost. The macOS client does not use this endpoint.

## Desired Outcome

A collapsible "Recent Runs" section in the menu bar popover (or a separate "History" tab)
showing the last 5–10 completed runs:

- Workflow name, status icon (success/failed/interrupted), and elapsed time.
- Tapping a row expands the inline run detail already built for active runs (reusing
  `RunDetailView` / `ActiveRunRow` patterns from the inline run detail feature).
- Fetched from `GET /workflow/runs?limit=10` alongside the existing status poll.
- Collapsed by default to keep the popover short.

## Constraints

- No daemon changes required; `GET /workflow/runs` is already documented in `docs/DAEMON-API.md`.
- Reuse `DaemonClient` fetch patterns and model types from `Models.swift`.
- Keep the popover width at 280pt; the run list should use compact rows.
- The run detail expansion should reuse or mirror the inline step detail already built for
  active runs, rather than duplicating the layout.

## Done When

- `AppState` fetches `GET /workflow/runs?limit=10` on each poll cycle.
- The menu popover shows a collapsible recent-runs list with status, name, and duration.
- Expanding a row shows step detail for that run.
- macOS client compiles and the run history section appears when the daemon is running.
