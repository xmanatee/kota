---
status: done
---

# "Move model directory to core/"

## Problem

Part of the src/ consolidation. model/ is a kernel concept with 34 importers across the codebase.

## Desired Outcome

`src/model/` lives under `src/core/model/`, all import paths updated, typecheck/lint/test/build pass.

- `src/model/` → `src/core/model/` (9 files, 34 importers)

## Constraints

- High importer count (34) — do this move alone to limit blast radius.

## Done When

- `src/model/` is under `src/core/model/`.
- All import paths updated. Typecheck, lint, test, build pass.
