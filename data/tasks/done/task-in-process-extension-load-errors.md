---
id: task-in-process-module-load-errors
title: Surface in-process module load failures in the web UI modules panel
status: done
priority: p2
area: reliability
summary: When in-process modules throw during onLoad or lifecycle hooks, errors go only to stderr. The web UI modules panel shows only successfully loaded modules, leaving operators blind to capability degradation from load failures.
created_at: 2026-04-08T20:22:18Z
updated_at: 2026-04-08T22:52:00Z
---

## Problem

`ModuleLoader.loadAll()` catches errors per module and logs them to stderr
(`console.error`), but load failures are not recorded anywhere the web UI can read.
`GET /api/modules` returns only successfully loaded modules. An in-process
module that throws during `onLoad` disappears silently — the operator has no panel
indication, no notification, and no way to see the error without tailing daemon logs.

Foreign (KEMP) modules already have health tracking (status, restart count, last
restart) exposed via `kota module inspect` and the modules panel. In-process
modules have no equivalent failure record.

## Desired Outcome

The `ModuleLoader` retains a list of load failures alongside its list of loaded
modules. Each failure record holds: module name, error message, and timestamp.

`GET /api/modules` includes these failed entries with `status: "failed"` and an
`error` field containing the message.

The web UI modules panel renders failed modules with a red health badge and
shows the truncated error message on hover or in an expanded row — consistent with
the existing ok/restarting/dead health badge pattern used for foreign modules.

## Constraints

- Failed module records are in-memory only (lost on daemon restart, same as foreign
  module health state).
- Do not change the `KotaModule` interface or the module-authoring contract.
- The `error` field in the API response should truncate to a reasonable length (e.g.,
  500 chars) to avoid bloating the status response.
- Failures during `onUnload` or reload do not need to be tracked for this task.

## Done When

- `ModuleLoader` stores load failures per module alongside loaded modules.
- `GET /api/modules` returns failed modules with `status: "failed"` and `error`.
- Web UI modules panel shows a red health badge for failed modules with error
  detail visible (hover, title attribute, or inline row).
- Integration test covers: failed module appears in API response with error detail;
  successfully loaded modules are unaffected.
