---
status: open
priority: p1
---

# Keep module log reads and writes in their authoritative runtime scope

## Confirmed failure

Reproduced on main `0fa8700c8`, September 11, 2026:

1. Initialize `ModuleLogStore` for disposable scope A through
   `initModuleLogStore(A)` and append an `audit-probe` entry with an A sentinel.
2. Call `runModuleFactory({action:"logs", name:"audit-probe"},
   {cwd:B, scopeRoot:B})` for a different disposable scope B.
3. The response contains A's sentinel, despite B being the requested scope.

`src/core/tools/module-factory/index.ts` drops context for `logs`; `logs.ts`
uses `getModuleLogStore()`. Module-context logging also looks up this singleton
on every write. `src/core/daemon/scope-runtime.ts` already creates a log store
per scope but installs the default store globally, leaving other scopes' callers
connected to the default scope's storage.

## Required outcome

Connect log production and queries to the existing scope/runtime ownership.
Remove the global lookup from scoped execution. Define the scope source for
request/session operations and activation diagnostics, preserving the distinction
between canonical `scopeRoot` and an isolated execution `cwd`. Operation logging
already receives an authoritative `scopeId`; loader storage cwd must not replace
that identity. Scope-less diagnostics must not be silently attributed to the
default project.

Use the existing runtime bundle and context seams rather than a second scope
registry or another global map of stores. Preserve log formatting and retention
with their current owner.

## Acceptance

- Two real scoped contexts can interleave writes and `module_factory` queries;
  each returns only its own entries, including the no-name listing action.
- Switching the default scope or tearing down another runtime does not redirect
  a surviving context's logs. Explicit operation scope remains authoritative.
- Missing/retired scope ownership is explicit; it cannot fall back to another
  scope. Validate canonical-scope versus worktree behavior through a real caller.
- Keep the regression with the scope/log owner; remove obsolete singleton
  assertions and guidance that would preserve the defect.

The module-filesystem task owns traversal and symlink confinement inside a
selected store. This task owns scope selection and attribution.
