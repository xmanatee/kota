---
id: task-fix-daemon-status-offline-and-stale-state-semantic
title: Fix daemon status offline and stale state semantics
status: done
priority: p1
area: client
summary: Make `kota status` distinguish live daemon state from offline persisted workflow files so it never shows dispatch or run counts as live when the daemon is unavailable.
created_at: 2026-06-11T22:23:50.879Z
updated_at: 2026-06-11T22:23:50.879Z
task_class: Product
---

## Problem

`kota status` could render `Daemon: not running (offline mode)` next to
`Dispatch: running` and live-looking run counts sourced from persisted
workflow files. That made the control plane untrustworthy exactly where the
operator needs a clear answer.

## Desired Outcome

`kota status` renders live dispatch, live runs, and sessions only when the
daemon control API is reachable. Offline persisted run state is rendered as
historical/offline diagnostic context, and `--explain` shows whether runtime
state came from the daemon or local files.

## Constraints

- Keep existing JSON/scripted commands stable.
- Preserve status output through the rendering module.
- Do not hide stale run-store signal; label it honestly as historical/offline
  state instead of live dispatch.

## Done When

- Offline status renders `Dispatch: offline` and live runs as unavailable.
- Stale persisted active/queued runs render under `Historical run store`.
- `kota status --explain` exposes the runtime source.
- Regression tests prevent `Daemon offline` plus `Dispatch running` from
  returning.

## Source / Intent

The 2026-06-11 audit found current `pnpm kota status` showing daemon offline
while still reporting dispatch as running and queued runs as live.

## Initiative

KOTA trustworthy control plane.

## Acceptance Evidence

- `pnpm test src/modules/daemon-ops/status-cli.test.ts` covers offline,
  historical run-store, and `--explain` rendering.
- `pnpm kota status --explain` transcript shows daemon-down status without
  live-looking dispatch/run counts.
