---
id: task-workflow-runs-daemon-api
title: Expose workflow run history and step detail via daemon control API
status: ready
priority: p2
area: runtime
summary: The daemon control API has no endpoint for workflow run history or step detail. Mobile and desktop clients that must be thin over the API cannot show run history or diagnose failures without reading .kota/ files directly — defeating the API-first architecture.
created_at: 2026-03-30T17:22:39Z
updated_at: 2026-03-30T17:44:28Z
---

## Problem

`DaemonControlServer` exposes workflow status, approvals, tasks, and history
(chat sessions), but nothing for workflow run records. `kota workflow list` and
`kota workflow show` read run metadata directly from `.kota/runs/` on disk.

The mobile client task (`task-build-mobile-client`) and macOS menu bar task both
require "recent run history with step detail" and mandate that clients read from
the daemon API only — no direct `.kota/` file access. Those tasks are currently
unimplementable as written because the API surface does not exist.

## Desired Outcome

Two new endpoints on `DaemonControlServer`:

- `GET /workflow/runs?workflow=<name>&limit=<n>` — returns recent run metadata
  (id, workflow name, status, trigger, startedAt, durationMs, totalCostUsd) for
  all workflows or filtered by name. Default limit 20, max 200.
- `GET /workflow/runs/:id` — returns full run detail: metadata plus per-step
  status, durationMs, error string, and cost. Does not return full log lines
  (those remain file-backed via `kota workflow follow`).

Both endpoints use `WorkflowRunStore` for reads. Both are tagged `read` scope
in the capability map and require Bearer token auth.

`kota workflow list` and `kota workflow show` should prefer the daemon API when
the daemon is running (via `DaemonControlClient`), falling back to direct disk
reads in offline mode — consistent with the pattern used by other operator
dashboard routes.

## Constraints

- Reuse `WorkflowRunStore` for data access — do not duplicate run-reading logic.
- Do not include full agent log output in the API response; keep responses JSON-serializable and bounded in size.
- Parallel with `GET /tasks`: simple read-only with a configurable limit, no pagination cursor needed for v1.
- Document the two new endpoints in `docs/DAEMON-API.md`.

## Done When

- `GET /workflow/runs` returns recent runs with metadata fields.
- `GET /workflow/runs/:id` returns run detail with per-step status and error.
- Both endpoints require auth and appear in the capability map.
- `kota workflow list` uses the daemon API when available.
- `kota workflow show` uses the daemon API when available.
- `docs/DAEMON-API.md` documents both endpoints.
