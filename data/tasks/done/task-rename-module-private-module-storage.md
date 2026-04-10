---
id: task-rename-module-private-module-storage
title: Rename remaining internal module-era module helper names
status: done
priority: p1
area: architecture
summary: Most module-private storage/log naming has been cleaned up, but internal helper names and comments still use `module` wording in places like module-factory state, middleware ownership, and module context comments. Finish that internal rename so the module model is consistent end to end.
created_at: 2026-03-27T18:09:52Z
updated_at: 2026-03-28T01:20:00Z
---

## Problem

The public model says `module`, but the internal runtime still uses
module-era names in places such as:

- `src/core/tools/module-factory/state.ts` — `MAX_MANIFEST_MODULES` constant
  (exported and used in `actions.ts`)
- `src/core/tools/module-factory/logs.ts` — file-level comment "Module Factory —
  log query handler"
- Test files in `module-factory/` that still use "module" in test names,
  descriptions, and variable names

The public-facing rename (commit 143a212) cleaned up exposed APIs, but these
internal constants, comments, and test vocabulary were not updated.

## Desired Outcome

Module-private storage, logging, and related runtime naming use
`module` terminology consistently.

## Constraints

- Do not add aliases or compatibility layers for old module-era names.
- Keep the change focused on internal module helper/runtime naming.
- Update docs and tests that describe or assert these surfaces.

## Done When

- Internal module helper names no longer expose `Module*`, `markModule*`,
  or `loadedModule*` vocabulary.
- Internal comments and helper text no longer describe module ownership or
  storage as "module" behavior.
- Docs describe the remaining internal module runtime with one consistent
  `module` vocabulary.
