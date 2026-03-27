---
id: task-rename-modules-dir-to-extensions
title: Rename src/modules/ directory to src/extensions/
status: ready
priority: p2
area: cleanup
summary: The src/modules/ directory contains built-in KotaExtension implementations but is still named after the old "module" concept. Renaming it to src/extensions/ completes the terminology shift started by the module→extension rename work.
created_at: 2026-03-27T13:02:00Z
updated_at: 2026-03-27T15:57:00Z
---

## Problem

`src/modules/` holds all built-in extensions (daemon, history, knowledge, mcp-server, memory, registry, scheduler, etc.) and already exports them as `KotaExtension[]` via `builtinExtensions`. The directory name `modules/` is the last significant surface that still uses the old terminology — inconsistent with the extension model documented in `ARCHITECTURE.md` and the ongoing rename work.

## Desired Outcome

- `src/modules/` → `src/extensions/`
- All import paths updated across the codebase (`from "../modules/...` → `from "../extensions/...`)
- `src/modules/AGENTS.md` moved to `src/extensions/AGENTS.md` with "modules" references updated to "extensions"
- No other behavior changes

## Constraints

- Pure rename — no logic changes.
- Update all import sites and `package.json`/`tsconfig.json` path references if any exist.
- Keep `src/extensions/index.ts` exporting `builtinExtensions` unchanged.
- The internal session and tool-registry rename is now complete (`task-remove-remaining-module-terminology` done 2026-03-27). No blocking dependency remains — this is a pure path rename.

## Done When

- `src/modules/` directory no longer exists
- `src/extensions/` directory exists with all former module files
- `grep -r "from.*modules/" src/` returns no matches (outside test fixtures if any)
- `npm run typecheck` passes
- `npm test` passes
