---
status: done
---

# "Move low-import src/ directories to core/: architect, manifest, mcp, module-testing, workflow-testing"

## Problem

Part of the src/ consolidation. These directories violate the two-layer guideline but have few importers, making them safe to move together.

## Desired Outcome

All 5 directories live under `src/core/`, all import paths updated, typecheck/lint/test/build pass.

- `src/architect/` → `src/core/architect/` (11 files, 1 importer)
- `src/manifest/` → `src/core/manifest/` (13 files, 5 importers)
- `src/mcp/` → `src/core/mcp/` (9 files, 6 importers)
- `src/module-testing/` → `src/core/modules/testing/` (2 files, 2 importers)
- `src/workflow-testing/` → `src/core/workflow/testing/` (4 files, 8 importers)

## Constraints

- Update local `AGENTS.md` files if they reference moved paths.

## Result

Completed by moving:

- `src/architect/` → `src/core/architect/`
- `src/manifest/` → `src/core/manifest/`
- `src/mcp/` → `src/core/mcp/`
- `src/module-testing/` → `src/core/modules/testing/`
- `src/workflow-testing/` → `src/core/workflow/testing/`

## Done When

- All 5 directories are under `core/`.
- All import paths updated. Typecheck, lint, test, build pass.
