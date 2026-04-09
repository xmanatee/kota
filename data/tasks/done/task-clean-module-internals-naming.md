---
id: task-clean-module-internals-naming
title: Clean up remaining module-era naming in module internals
status: done
priority: p3
area: refactor
summary: The module→module migration is mostly complete in public APIs, but several internals still use module-era names (modules, mod, moduleRoutes, MODULE_NAME_RE, BUILTIN_MODULE_NAMES). Clean these up to finish the terminology migration and keep the codebase consistent.
created_at: 2026-03-28T01:35:31Z
updated_at: 2026-03-30T00:00:00Z
---

## Problem

The public module API (`extension_factory`, `getModuleConfig`,
`config.modules`, `src/modules/`) now consistently uses module
terminology. However, several internals still carry module-era names:

- `src/manifest/validation.ts`: `MODULE_NAME_RE`, `BUILTIN_MODULE_NAMES`,
  error messages referencing "module"
- `src/module-discovery.ts`: local variable `modules`, parameter `mod`
- `src/module-loader.ts`: parameter name `mod`, comment "load modules"
- `src/server/server.ts` and `server-routes.ts`: parameter `moduleRoutes`,
  comment "Routes registered by modules"
- `src/modules/web.ts`: variable `moduleRoutes`, comment "Collect routes
  from all loaded modules"

This is explicitly flagged in the root `AGENTS.md` Architecture section:
"Some module internals, diagnostics, and manifest-era helpers still carry
module-era naming and should be cleaned up instead of treated as a permanent
second vocabulary."

## Desired Outcome

All internal names in the files above are updated to use module terminology:
`modules` → `modules`, `mod` → `ext`, `moduleRoutes` → `moduleRoutes`,
`MODULE_NAME_RE` → `EXTENSION_NAME_RE`, `BUILTIN_MODULE_NAMES` →
`BUILTIN_EXTENSION_NAMES`. Comments updated to match.

## Constraints

- No behavior changes — rename only, no logic changes.
- All existing tests pass after rename.
- Update the root `AGENTS.md` Architecture section to remove the "should be
  cleaned up" note once done.

## Done When

- None of the affected files contain `module` in identifier names in a
  non-comment, non-string context (aside from standard JS module semantics).
- All existing tests pass.
- `AGENTS.md` Architecture section updated to reflect completion.
