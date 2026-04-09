---
id: task-watch-trigger-status-cli
title: Show active file-watch triggers in kota workflow status output
status: done
priority: p3
area: cli
summary: Workflows with file-watch triggers register glob patterns at daemon start, but there is no CLI or web UI surface to confirm which globs are actively watched and which workflows they will fire.
created_at: 2026-04-02T00:00:00Z
updated_at: 2026-04-02T01:06:00Z
---

## Problem

Workflows can declare `watch: "src/**/*.ts"` triggers that fire automatically when
matching files change. The `WatchTriggerManager` loads these at runtime, but operators
have no way to inspect which globs are active without reading workflow source files
directly.

When a file-watch workflow unexpectedly fires (or fails to fire), operators cannot
easily verify the registered glob list or see when the last watch event was processed.
This makes diagnosing misconfigured watch triggers unnecessarily difficult.

## Desired Outcome

- `kota workflow list` (or a dedicated `kota workflow triggers` subcommand) shows
  a summary of active file-watch triggers: workflow name and glob patterns.
- The daemon control API (`GET /api/workflows`) returns watch trigger metadata so the
  web UI can display it without a separate endpoint.
- Optionally, the last-triggered timestamp is included when available.

## Constraints

- The daemon must expose watch trigger state via its existing control API patterns —
  no new persistence layer.
- Display is read-only; no mutation of watch subscriptions via CLI.
- Keep the CLI output compact and additive — do not break existing `kota workflow list`
  formatting for workflows without watch triggers.
- Web UI change is optional/bonus; the CLI surface is the primary requirement.

## Done When

- `kota workflow list` (or `kota workflow triggers`) shows active watch triggers per
  workflow when the daemon is running.
- The daemon control API response for workflows includes watch glob metadata.
- At least one unit or integration test covers the new API field.
