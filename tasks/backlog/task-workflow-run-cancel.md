---
id: task-workflow-run-cancel
title: Add API and CLI command to cancel a queued workflow run before it starts
status: backlog
priority: p3
area: runtime
summary: The daemon supports aborting active runs but offers no way to cancel a run that is queued but has not started yet. Operators who want to pull back an accidentally triggered run must restart the daemon.
created_at: 2026-03-31T16:34:49Z
updated_at: 2026-03-31T16:34:49Z
---

## Problem

`POST /workflow/abort` cancels runs that are actively executing, but has no effect on runs that are
queued and waiting to start. `Scheduler.cancel(id)` already implements the in-memory cancellation
path (`item.status = "cancelled"`), but there is no daemon control API endpoint or CLI command
that exposes it. An operator who accidentally triggers a long workflow must wait for it to start
before aborting it, or restart the daemon entirely.

## Desired Outcome

A `DELETE /workflow/runs/:id` (or `POST /workflow/runs/:id/cancel`) daemon control API endpoint
that:

- Cancels a queued (pending) run by its run ID.
- Returns `200 { ok: true }` when successfully cancelled.
- Returns `404` if the run ID does not exist.
- Returns `409` if the run is already active or completed (i.e., not cancellable).

A `kota workflow cancel <run-id>` CLI command that calls the endpoint when a daemon is running.

## Constraints

- Active (running) runs must still use `POST /workflow/abort`; this endpoint targets pending runs only.
- Follow the existing daemon control endpoint pattern in `daemon-control-workflow.ts`.
- The endpoint requires `control` scope (same as `/abort`, `/pause`, `/resume`).
- Document the new endpoint in `docs/DAEMON-API.md`.

## Done When

- The daemon control API exposes a cancel endpoint for queued runs.
- `kota workflow cancel <run-id>` calls the endpoint when a daemon is running.
- Attempting to cancel an active or completed run returns a clear error.
- New endpoint is documented in `docs/DAEMON-API.md`.
- At least one unit test covers the cancel path.
