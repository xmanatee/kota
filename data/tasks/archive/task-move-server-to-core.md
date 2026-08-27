---
status: done
---

# "Move server directory to core/"

## Problem

Part of the src/ consolidation. server/ has 29 importers and is a daemon subsystem that belongs in core/.

## Desired Outcome

`src/server/` lives under `src/core/server/`, all import paths updated, typecheck/lint/test/build pass.

- `src/server/` → `src/core/server/` (14 files, 29 importers)

## Constraints

- High importer count (29) — do this move alone.

## Result

Completed by moving `src/server/` to `src/core/server/` and updating import paths.

## Done When

- `src/server/` is under `src/core/server/`.
- All import paths updated. Typecheck, lint, test, build pass.
