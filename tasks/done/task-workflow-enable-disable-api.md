---
id: task-workflow-enable-disable-api
title: Add CLI and daemon API to enable or disable individual workflows at runtime
status: done
priority: p3
area: operator-ux
summary: Workflows can be disabled via the `enabled: false` field in their definition, but there is no way to toggle this at runtime without editing the source file. A CLI command and daemon endpoint to enable or disable a workflow by name would let operators pause individual workflows during incidents or testing without a file edit.
created_at: 2026-04-02T05:47:58Z
updated_at: 2026-04-02T05:47:58Z
---

## Problem

`WorkflowDefinition.enabled` exists and is enforced by the runtime — a disabled workflow is
skipped for scheduling and cannot be manually triggered. However, toggling it requires editing
the workflow definition TypeScript file and reloading definitions. For incident response (e.g.,
"stop the builder from auto-committing until I review") this is too slow.

There is no `kota workflow enable <name>` or `kota workflow disable <name>` command, and no
daemon API endpoint for per-workflow enable/disable. The only coarser alternative is `POST
/workflow/pause`, which pauses all workflows globally.

## Desired Outcome

- `POST /workflow/definitions/:name/disable` and `POST /workflow/definitions/:name/enable`
  daemon control endpoints that override the enabled state for the named workflow in the
  runtime's in-memory definition registry.
- `kota workflow disable <name>` and `kota workflow enable <name>` CLI commands that call
  these endpoints when a daemon is running; print a clear message if the daemon is unreachable.
- The override is in-memory only: it does not write to the definition source file and does not
  persist across daemon restarts. The daemon's `POST /workflow/reload` call resets overrides.
- The override state is visible in `GET /workflow/definitions` responses (a new `runtimeEnabled`
  field distinct from the definition's `enabled` field).
- Disabling a workflow cancels any pending queued runs for it (same as the existing `enabled:
  false` check in `maybeStartNext`).

## Constraints

- In-memory override only — no writes to the definition source.
- Reload (`POST /workflow/reload`) clears all runtime overrides and re-reads from source.
- Endpoints require `control` capability scope (same as pause/resume).
- `GET /workflow/definitions` response includes a `runtimeEnabled` field when it differs from
  the definition's static `enabled` field.
- Document the new endpoints in `docs/DAEMON-API.md`.

## Done When

- `POST /workflow/definitions/:name/disable` and `/enable` are handled by the daemon.
- `kota workflow disable <name>` and `kota workflow enable <name>` CLI commands exist.
- A disabled workflow is not dispatched and cannot be manually triggered; the error message
  cites the name.
- `GET /workflow/definitions` includes the runtime override state.
- New endpoints are documented in `docs/DAEMON-API.md`.
- A unit test covers the enable/disable toggle and its effect on `maybeStartNext`.
