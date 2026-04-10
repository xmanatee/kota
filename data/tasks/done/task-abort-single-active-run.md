---
id: task-abort-single-active-run
title: Add per-run abort to stop a single active workflow run by ID
status: done
priority: p2
area: runtime
summary: The daemon can only abort all active runs at once. Operators have no way to stop a single misbehaving run without killing every other run in progress.
created_at: 2026-04-01T09:44:18Z
updated_at: 2026-04-01T10:00:00Z
---

## Problem

`POST /workflow/abort` aborts every active run simultaneously. The runtime already maintains a per-run `AbortController` but there is no API surface to fire it for a single run. Operators who want to stop one runaway build or stuck agent step must either wait for it to hit its timeout or abort all concurrent runs — which is disruptive in busy systems.

The CLI mirrors this gap: `kota workflow abort` takes no run-ID argument.

## Desired Outcome

A new control endpoint `POST /workflow/runs/:id/abort` that aborts a specific active run by ID, leaving other active runs untouched. The CLI gains a `kota workflow run abort <run-id>` subcommand that calls this endpoint.

If the ID is unknown or not currently active the endpoint returns a clear 404 or 409. On success the targeted run terminates on its next step boundary (same clean-abort semantics as the global abort).

## Constraints

- Reuse the existing per-run `AbortController` already present in `src/core/workflow/runtime.ts`; do not add a parallel signal path.
- The new endpoint requires `control` capability scope, same as `POST /workflow/abort`.
- Active runs that are not targeted must be completely unaffected.
- CLI command follows existing `kota workflow run <subcommand>` convention.
- No changes to run storage or run metadata format needed.

## Done When

- `POST /workflow/runs/:id/abort` aborts the targeted run and returns `{ ok: true }`.
- Returns 404 if the run ID is unknown, 409 if the run is queued (not active).
- `kota workflow run abort <run-id>` calls the endpoint and prints the result.
- Unit test covers: abort of an active run, 404 for unknown ID, 409 for queued run.
- `docs/DAEMON-API.md` documents the new endpoint.
