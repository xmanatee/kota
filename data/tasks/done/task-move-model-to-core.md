---
id: task-move-model-to-core
title: "Move model directory to core/"
status: done
priority: p2
area: architecture
summary: "Move model (9 files, 34 importers) from src/ root into core/. High importer count — do this one alone."
created_at: 2026-04-10T16:08:00Z
updated_at: 2026-04-10T16:08:00Z
---

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
