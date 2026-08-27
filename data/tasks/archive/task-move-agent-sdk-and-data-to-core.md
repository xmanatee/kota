---
status: done
---

# "Move agent-sdk and data directories to core/"

## Problem

Part of the src/ consolidation. These are kernel-level utilities that belong in core/.

## Desired Outcome

Both `src/agent-sdk/` and `src/data/` live under `src/core/`, all import paths updated, typecheck/lint/test/build pass.

- `src/agent-sdk/` → `src/core/agent-sdk/` (7 files, 17 importers)
- `src/data/` → `src/core/data/` (16 files, 10 importers)

## Constraints

- Move both directories together since they have moderate importer counts.

## Done When

- Both directories are under `core/`.
- All import paths updated. Typecheck, lint, test, build pass.
