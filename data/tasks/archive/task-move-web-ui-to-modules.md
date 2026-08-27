---
status: done
---

# "Move web-ui directory to modules/"

## Problem

Part of the src/ consolidation. web-ui/ is an operator surface that belongs in modules/, not at the src/ root.

## Desired Outcome

`src/web-ui/` lives under `src/modules/web-ui/`, all import paths updated, typecheck/lint/test/build pass.

- `src/web-ui/` → `src/modules/web-ui/` (35 files, 1 importer)

## Constraints

- Low importer count (1) despite many files (35).

## Done When

- `src/web-ui/` is under `src/modules/web-ui/`.
- All import paths updated. Typecheck, lint, test, build pass.
