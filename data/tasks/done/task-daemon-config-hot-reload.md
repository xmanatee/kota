---
id: task-daemon-config-hot-reload
title: Reload daemon config and modules without restart
status: done
priority: p2
area: runtime
summary: Adding or removing an module still requires a daemon restart. A reload mechanism would let operators update module config and contributions without interrupting unrelated work.
created_at: 2026-03-30T18:28:41Z
updated_at: 2026-04-08T15:00:00Z
---

## Problem

When an operator adds a new module to `config.modules`, renames an module path,
or removes one, the daemon must be stopped and restarted. Any active workflow runs are
interrupted. Operators developing modules face a restart loop that grows tedious as
the daemon accumulates longer startup time.

There is no `kota reload` command and no file-watcher that detects config changes.

## Desired Outcome

A `kota daemon reload` command (or `POST /reload` daemon control API endpoint) that:

- Re-reads `config.json` from disk.
- Calls `onUnload` on modules that have been removed or whose config changed.
- Loads and initializes new or changed modules via `onLoad`.
- Re-registers contributed tools, agents, workflows, and channels from the updated set.
- Leaves active workflow runs undisturbed if they are not affected by the changed module.

A bonus (but not required): a file-watcher on `config.json` that auto-triggers reload on
save, controlled by a `daemon.autoReload` config flag (default: off).

## Constraints

- Do not interrupt or abort active workflow runs unless the run's workflow definition came
  from an module that was removed. If it must be interrupted, emit a warning and allow
  the run to complete its current step before unloading.
- Follow the existing module lifecycle: `onLoad` / `onUnload` must be called in the
  correct order.
- The control API endpoint should require `write` scope (same as `/pause`, `/resume`).
- Auto-reload file-watcher is opt-in only; do not enable by default.
- Document the endpoint in `docs/DAEMON-API.md`.

## Done When

- `POST /reload` on the daemon control API triggers a config re-read and module
  lifecycle refresh.
- `kota daemon reload` CLI command calls the endpoint when a daemon is running.
- Modules that have not changed are not re-initialized.
- Active workflow runs complete without interruption unless their module was removed.
- New endpoint is documented in `docs/DAEMON-API.md`.
