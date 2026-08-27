---
status: done
---

# Move cli-history files from src root into a module

## Problem

`src/cli-history.ts` and `src/cli-history-commands.ts` are production files
sitting in the `src/` root outside any module. The root entrypoint allowlist
task identified them as needing an ownership decision, and they are the last
visible module-first architecture debt.

## Desired Outcome

Move both files into the module that owns CLI history interaction. Update
imports across the codebase to point to the new location. The `src/` root
should contain only files in the known entrypoint allowlist after this change.

## Constraints

- Do not change runtime behavior.
- All existing imports must be updated; no re-exports from the old location.
- `typecheck`, `test`, and `build` must pass after the move.

## Done When

- `src/cli-history.ts` and `src/cli-history-commands.ts` no longer exist in `src/` root.
- Both files live inside an appropriate module directory.
- No import breakage; all checks pass.
- `listVisibleArchitectureDebt` returns an empty list.
