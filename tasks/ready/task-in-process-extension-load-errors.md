---
id: task-in-process-extension-load-errors
title: Surface in-process extension load failures in the web UI extensions panel
status: ready
priority: p2
area: reliability
summary: When in-process extensions throw during onLoad or lifecycle hooks, errors go only to stderr. The web UI extensions panel shows only successfully loaded extensions, leaving operators blind to capability degradation from load failures.
created_at: 2026-04-08T20:22:18Z
updated_at: 2026-04-08T21:00:00Z
---

## Problem

`ExtensionLoader.loadAll()` catches errors per extension and logs them to stderr
(`console.error`), but load failures are not recorded anywhere the web UI can read.
`GET /api/extensions` returns only successfully loaded extensions. An in-process
extension that throws during `onLoad` disappears silently — the operator has no panel
indication, no notification, and no way to see the error without tailing daemon logs.

Foreign (KEMP) extensions already have health tracking (status, restart count, last
restart) exposed via `kota extension inspect` and the extensions panel. In-process
extensions have no equivalent failure record.

## Desired Outcome

The `ExtensionLoader` retains a list of load failures alongside its list of loaded
extensions. Each failure record holds: extension name, error message, and timestamp.

`GET /api/extensions` includes these failed entries with `status: "failed"` and an
`error` field containing the message.

The web UI extensions panel renders failed extensions with a red health badge and
shows the truncated error message on hover or in an expanded row — consistent with
the existing ok/restarting/dead health badge pattern used for foreign extensions.

## Constraints

- Failed extension records are in-memory only (lost on daemon restart, same as foreign
  extension health state).
- Do not change the `KotaExtension` interface or the extension-authoring contract.
- The `error` field in the API response should truncate to a reasonable length (e.g.,
  500 chars) to avoid bloating the status response.
- Failures during `onUnload` or reload do not need to be tracked for this task.

## Done When

- `ExtensionLoader` stores load failures per extension alongside loaded extensions.
- `GET /api/extensions` returns failed extensions with `status: "failed"` and `error`.
- Web UI extensions panel shows a red health badge for failed extensions with error
  detail visible (hover, title attribute, or inline row).
- Integration test covers: failed extension appears in API response with error detail;
  successfully loaded extensions are unaffected.
