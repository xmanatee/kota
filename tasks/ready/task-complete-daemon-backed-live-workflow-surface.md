---
id: task-complete-daemon-backed-live-workflow-surface
title: Complete the daemon-backed live workflow surface
status: ready
priority: p1
area: runtime
summary: The daemon control API exists, but workflow triggering and some live run inspection paths still bypass it and touch `.kota/` directly. Finish the boundary so live workflow control and inspection are daemon-backed end to end.
created_at: 2026-03-27T21:30:00Z
updated_at: 2026-03-27T21:30:00Z
---

## Problem

KOTA now has a real daemon control API, but the live boundary is still split.
`POST /api/workflow/trigger` still writes to `.kota/workflow-state.json`, and
some run inspection paths still read `.kota/runs/` directly even when the
daemon is running.

That leaves the daemon as only a partial source of truth and keeps the client
story fuzzier than the architecture intends.

## Desired Outcome

Live workflow trigger, status, and run inspection behavior go through the
daemon when it is running. Durable run artifacts stay on disk as evidence, but
clients no longer bypass the daemon for live workflow control or live run
inspection.

## Constraints

- Keep standalone non-daemon flows possible where they are explicitly intended.
- Do not add a second live control protocol or a parallel server path.
- Preserve `.kota/` files as persistence and audit evidence rather than deleting
  them.

## Done When

- Workflow trigger uses the daemon API when targeting a running daemon.
- Live workflow/run inspection paths stop bypassing the daemon for state the
  daemon already owns.
- The daemon/client boundary is documented honestly and consistently.
- Tests cover the daemon-backed live workflow paths.
