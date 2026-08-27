---
status: done
---

# Rename src/modules/ directory to src/modules/

## Problem

`src/modules/` holds all built-in modules (daemon, history, knowledge, mcp-server, memory, registry, scheduler, etc.) and already exports them as `KotaModule[]` via `repoExtensions`. The directory name `modules/` is the last significant surface that still uses the old terminology — inconsistent with the module model documented in `ARCHITECTURE.md` and the ongoing rename work.

## Desired Outcome

- `src/modules/` → `src/modules/`
- All import paths updated across the codebase (`from "../modules/...` → `from "../modules/...`)
- `src/modules/AGENTS.md` moved to `src/modules/AGENTS.md` with "modules" references updated to "modules"
- No other behavior changes

## Constraints

- Pure rename — no logic changes.
- Update all import sites and `package.json`/`tsconfig.json` path references if any exist.
- Keep `src/modules/index.ts` exporting `repoExtensions` unchanged.
- The internal session and tool-registry rename is now complete (`task-remove-remaining-module-terminology` done 2026-03-27). No blocking dependency remains — this is a pure path rename.

## Done When

- `src/modules/` directory no longer exists
- `src/modules/` directory exists with all former module files
- `grep -r "from.*modules/" src/` returns no matches (outside test fixtures if any)
- `npm run typecheck` passes
- `npm test` passes
