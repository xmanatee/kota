---
id: task-macos-client-run-detail
title: Add inline run detail view to macOS menu bar client
status: ready
priority: p3
area: operator-ux
summary: The macOS menu bar client shows active run names and elapsed time but no step progress or log output. Clicking a run should show the current step and a recent log tail inline, reducing the need to open the browser dashboard for a quick status check.
created_at: 2026-04-01T06:25:00Z
updated_at: 2026-04-01T07:22:00Z
---

## Problem

`ActiveRunRow` in `MenuBarView.swift` shows the workflow name and elapsed time only. When an
operator wants to know which step is running or why a run is taking longer than usual, they
must open the browser dashboard (`Open Dashboard` button). For a quick status check, this is
disproportionate friction.

The daemon API already provides run detail via `GET /workflow/runs/:id`, which includes step
results with status, timing, and output.

## Desired Outcome

Clicking an active run row in the menu bar expands an inline detail view that shows:
- Current step name and status (running, completed, failed).
- Elapsed time for the current step.
- Up to the last 5 log lines or the most recent step's agent output summary (truncated to
  ~200 characters).

Clicking again (or pressing Escape) collapses the row back to the summary line.

The expansion fetches from `GET /workflow/runs/:id` on demand; it does not poll continuously.
A small "Refresh" icon on the expanded row lets the operator re-fetch on demand.

## Constraints

- Do not add any Swift Package dependencies.
- Expansion must not change the fixed width (280px) of the menu bar popover.
  Log text should truncate/wrap within the popover width.
- Keep the fetch on-demand (tap to expand); do not add a separate polling interval for
  run detail data.
- This is a read-only view; no actions beyond collapse and manual refresh.
- Do not change `AppState` polling behavior — the 5-second status poll is sufficient for
  the run list; detail is fetched separately.

## Done When

- Tapping an active run row expands an inline detail section with current step and log snippet.
- Tapping again collapses the row.
- The expanded view fetches `GET /workflow/runs/:id` using `DaemonClient`.
- A refresh icon re-fetches the detail without closing the expansion.
- The 280px menu bar width is preserved; long text truncates with ellipsis.
