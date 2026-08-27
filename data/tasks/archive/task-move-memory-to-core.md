---
status: done
---

# "Move memory directory to core/"

## Problem

Part of the src/ consolidation. memory/ is a kernel concept with the most importers in the codebase (36).

## Desired Outcome

`src/memory/` lives under `src/core/memory/`, all import paths updated, typecheck/lint/test/build pass.

- `src/memory/` → `src/core/memory/` (20 files, 36 importers)

## Constraints

- Highest importer count in the codebase (36) — do this move alone.

## Result

Completed by moving `src/memory/` to `src/core/memory/` and updating import paths.

## Done When

- `src/memory/` is under `src/core/memory/`.
- All import paths updated. Typecheck, lint, test, build pass.
