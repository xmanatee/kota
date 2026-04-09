---
id: task-remove-remaining-module-terminology
title: Rename module* → module* in session internals and tool registry
status: done
priority: p2
area: cleanup
summary: >
  The codebase still uses "module" terminology for the module loader and
  related internals — `moduleLoader`, `getLoadedModules`, `deregisterModuleTools`,
  `pluginModules` — despite the public surface having moved to "module".
  Renaming these to match closes the gap noted in docs/ARCHITECTURE.md.
created_at: 2026-03-27T12:40:00Z
updated_at: 2026-03-27T12:52:00Z
---

## Problem

`docs/ARCHITECTURE.md` notes that "the code still carries old module-oriented
naming in a few public interfaces and comments." The concrete instances are:

- `AgentLoopState.moduleLoader` (`loop-init.ts:59`) and `AgentSession.moduleLoader` (`loop.ts:60`)
- `state.moduleLoader` usages in `loop-constructor.ts` and `loop-init.ts`
- `ModuleLoader.getLoadedModules()` method name
- `deregisterModuleTools(moduleName)` in `tools/index.ts` (both the function name and the parameter)
- Local variables `pluginModules` in `loop-init.ts` and `cli.ts`
- `ModuleLoader` private fields: `modules`, `moduleStorages`, `moduleRegistry`, `moduleToolCounts`
- Comments in `module-types.ts` that say "modules" where they mean "modules"

## Desired Outcome

All session-internal and tool-registry references use "module" terminology
consistently:

- `moduleLoader` → `moduleLoader`
- `getLoadedModules()` → `getLoadedModules()`
- `deregisterModuleTools` → `deregisterModuleTools`
- `pluginModules` local vars → `modules`
- Private fields in `ModuleLoader` updated to `modules`, `moduleStorages`, etc.
- Comments in `module-types.ts` updated

## Constraints

- Pure rename — no behavior changes.
- Update all call sites to keep the build clean.
- Keep test files consistent with production code.

## Done When

- `grep -r "moduleLoader\|getLoadedModules\|deregisterModuleTools\|pluginModules" src/` returns no matches in non-test files.
- `npm run typecheck` passes.
- `npm test` passes.
