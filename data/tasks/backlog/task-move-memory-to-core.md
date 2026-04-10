---
id: task-move-memory-to-core
title: "Move memory directory to core/"
status: backlog
priority: p2
area: architecture
summary: "Move memory (20 files, 36 importers) from src/ root into core/. Highest importer count — do this one alone."
created_at: 2026-04-10T16:08:00Z
updated_at: 2026-04-10T16:08:00Z
---

## Problem

Part of the src/ consolidation. memory/ is a kernel concept with the most importers in the codebase (36).

## Desired Outcome

`src/memory/` lives under `src/core/memory/`, all import paths updated, typecheck/lint/test/build pass.

- `src/memory/` → `src/core/memory/` (20 files, 36 importers)

## Constraints

- Highest importer count in the codebase (36) — do this move alone.

## Done When

- `src/memory/` is under `src/core/memory/`.
- All import paths updated. Typecheck, lint, test, build pass.
