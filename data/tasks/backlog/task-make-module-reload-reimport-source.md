---
id: task-make-module-reload-reimport-source
title: Make module reload semantics match dynamic source loading
status: backlog
priority: p2
area: modules
summary: Module reload currently reloads the same in-memory module object, so it does not reliably pick up changed module source.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:16:25Z
---

## Problem

Project and user modules are discovered dynamically, but `reloadModule` uses the
module object already held in `moduleRegistry`. That unloads and re-runs module
registration, but it does not necessarily re-import changed source code. The
operator-facing idea of dynamic modules is therefore stronger than the actual
reload mechanism.

This matters for autonomous runs that change module code and expect the daemon
to pick up updated non-core behavior without a full process restart.

## Desired Outcome

Module reload has precise semantics. If KOTA claims source reload, it re-discovers
and re-imports the module entry from disk. If a full daemon restart is required
for a class of changes, the runtime makes that explicit and routes through the
restart path instead of pretending to hot reload.

## Constraints

- Do not add brittle cache-busting hacks without understanding ESM cache behavior.
- Do not weaken dependency or unload safety.
- Do not keep docs that overstate reload behavior.
- Keep core module lifecycle small and typed.

## Done When

- `kota module reload <name>` has behavior that matches its docs.
- Reload tests prove whether a changed module source file is picked up or a restart is required.
- Module lifecycle docs distinguish reload, unload/load, and daemon restart without migration notes.
- Autonomous workflow restart behavior remains correct when core or module code changes.
