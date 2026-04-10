---
id: task-move-agent-sdk-and-data-to-core
title: "Move agent-sdk and data directories to core/"
status: done
priority: p2
area: architecture
summary: "Move agent-sdk (7 files, 17 importers) and data (16 files, 10 importers) from src/ root into core/."
created_at: 2026-04-10T16:08:00Z
updated_at: 2026-04-10T16:08:00Z
---

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
