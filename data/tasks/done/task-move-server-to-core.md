---
id: task-move-server-to-core
title: "Move server directory to core/"
status: done
priority: p2
area: architecture
summary: "Move server (14 files, 29 importers) from src/ root into core/. High importer count — do this one alone."
created_at: 2026-04-10T16:08:00Z
updated_at: 2026-04-10T18:45:00Z
---

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
