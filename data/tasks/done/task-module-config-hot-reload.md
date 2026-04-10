---
id: task-module-config-hot-reload
title: Support per-module config updates via daemon reload without restarting unaffected modules
status: done
priority: p2
area: runtime
summary: kota daemon reload currently restarts all modules even when only one module's config changed. Tracking per-module config snapshots and only reloading changed modules would reduce reload disruption and keep unaffected sessions alive.
created_at: 2026-04-08T21:43:21Z
updated_at: 2026-04-10T10:45:00Z
---

## Problem

`kota daemon reload` triggers a full module unload/reload cycle for every loaded
module, regardless of which config keys changed. This has two consequences:

1. An operator who updates a single module's credentials (e.g., a Telegram bot token)
   causes every other module — filesystem, git, GitHub — to also unload and reload,
   briefly interrupting any in-flight tool calls that depend on them.
2. Foreign (KEMP) modules restart their subprocesses unnecessarily, adding latency
   and potentially losing subprocess state.

The `ModuleLoader` and `module-lifecycle.ts` already support per-module
`unload` and `reload` operations. The gap is that the reload path does not compare
old vs. new config to determine which modules actually need reloading.

## Desired Outcome

The daemon's config-reload handler computes a per-module config diff. Only modules
whose config subtree changed (or whose dependencies changed) are unloaded and reloaded.
Modules with identical config are left running.

A `changedModules` list is returned in the `POST /api/daemon/reload` response so
operators and tooling can see what was restarted.

`kota daemon reload` CLI output shows which modules reloaded and which were skipped.

## Constraints

- Diff is based on the resolved `modules.<name>` config object (deep equality). If
  the key is absent before and after, the module is not restarted.
- Global config keys that affect all modules (e.g., `providers`, `guardrails`) still
  trigger a full reload when they change.
- Module dependency ordering is preserved: if module A depends on module B and
  B's config changed, A must also reload.
- No changes to the `KotaModule` interface.
- Foreign module subprocess restarts still follow the existing backoff strategy.

## Done When

- `POST /api/daemon/reload` returns a `changedModules` array listing only reloaded
  modules.
- Updating one module's config via `kota config set` and running `kota daemon reload`
  restarts only that module.
- Changing a global config key causes full reload as before.
- `kota daemon reload` CLI output indicates per-module reload status.
- Unit test covers: no-change (no modules restarted), single-module change
  (only that module restarted), global-key change (all modules restarted).
