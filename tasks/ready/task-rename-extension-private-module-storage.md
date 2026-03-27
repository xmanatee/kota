---
id: task-rename-extension-private-module-storage
title: Rename extension-private module storage and logging surfaces
status: ready
priority: p1
area: architecture
summary: Extension-private storage and logging still use module-era names like `.kota/modules`, `ModuleLogStore`, and `moduleName`; finish that internal rename so the extension model is consistent end to end.
created_at: 2026-03-27T18:09:52Z
updated_at: 2026-03-27T18:09:52Z
---

## Problem

The public model says `extension`, but the extension-private runtime still uses
module-era names and paths:

- `.kota/modules/<name>/` for extension-private storage
- `ModuleLogStore`, `initModuleLogStore`, and `getModuleLogStore`
- `moduleName` / `[module:<name>]` naming in extension context and logging

That keeps a second vocabulary alive in the core extension runtime even after
the public rename work.

## Desired Outcome

Extension-private storage, logging, and related runtime naming use
`extension` terminology consistently.

## Constraints

- Do not add aliases or compatibility layers for old module-era names.
- Keep the change focused on extension-private storage/logging/runtime naming.
- Update docs and tests that describe or assert these surfaces.

## Done When

- Extension-private runtime paths no longer use `.kota/modules/`.
- `ModuleLogStore`-style names are gone from production code.
- Extension context/log output no longer uses `[module:...]`.
- Docs describe the extension-private store/log surface with one consistent
  `extension` vocabulary.
