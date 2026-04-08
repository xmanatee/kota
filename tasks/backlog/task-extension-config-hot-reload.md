---
id: task-extension-config-hot-reload
title: Support per-extension config updates via daemon reload without restarting unaffected extensions
status: backlog
priority: p3
area: runtime
summary: kota daemon reload currently restarts all extensions even when only one extension's config changed. Tracking per-extension config snapshots and only reloading changed extensions would reduce reload disruption and keep unaffected sessions alive.
created_at: 2026-04-08T21:43:21Z
updated_at: 2026-04-08T21:43:21Z
---

## Problem

`kota daemon reload` triggers a full extension unload/reload cycle for every loaded
extension, regardless of which config keys changed. This has two consequences:

1. An operator who updates a single extension's credentials (e.g., a Telegram bot token)
   causes every other extension — filesystem, git, GitHub — to also unload and reload,
   briefly interrupting any in-flight tool calls that depend on them.
2. Foreign (KEMP) extensions restart their subprocesses unnecessarily, adding latency
   and potentially losing subprocess state.

The `ExtensionLoader` and `extension-lifecycle.ts` already support per-extension
`unload` and `reload` operations. The gap is that the reload path does not compare
old vs. new config to determine which extensions actually need reloading.

## Desired Outcome

The daemon's config-reload handler computes a per-extension config diff. Only extensions
whose config subtree changed (or whose dependencies changed) are unloaded and reloaded.
Extensions with identical config are left running.

A `changedExtensions` list is returned in the `POST /api/daemon/reload` response so
operators and tooling can see what was restarted.

`kota daemon reload` CLI output shows which extensions reloaded and which were skipped.

## Constraints

- Diff is based on the resolved `extensions.<name>` config object (deep equality). If
  the key is absent before and after, the extension is not restarted.
- Global config keys that affect all extensions (e.g., `providers`, `guardrails`) still
  trigger a full reload when they change.
- Extension dependency ordering is preserved: if extension A depends on extension B and
  B's config changed, A must also reload.
- No changes to the `KotaExtension` interface.
- Foreign extension subprocess restarts still follow the existing backoff strategy.

## Done When

- `POST /api/daemon/reload` returns a `changedExtensions` array listing only reloaded
  extensions.
- Updating one extension's config via `kota config set` and running `kota daemon reload`
  restarts only that extension.
- Changing a global config key causes full reload as before.
- `kota daemon reload` CLI output indicates per-extension reload status.
- Unit test covers: no-change (no extensions restarted), single-extension change
  (only that extension restarted), global-key change (all extensions restarted).
