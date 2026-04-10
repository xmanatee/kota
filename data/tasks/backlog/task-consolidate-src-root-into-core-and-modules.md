---
id: task-consolidate-src-root-into-core-and-modules
title: Consolidate src/ root-level directories and loose files into core/ and modules/
status: backlog
priority: p2
area: architecture
summary: The documented two-layer guideline (src/core/ + src/modules/) is violated by 11 extra root-level directories and ~40 loose .ts files under src/. Move them into core/ or modules/ to match the documented structure.
created_at: 2026-04-10T13:45:00Z
updated_at: 2026-04-10T13:45:00Z
---

## Problem

`src/AGENTS.md` documents that `src/` has two layers: `core/` (kernel) and
`modules/` (pluggable project modules), with the guideline "Avoid new root-level
buckets under `src/`." The current state has 11 extra directories and ~40 loose
files directly under `src/`, accumulated through organic growth.

## Desired Outcome

Directories and files directly under `src/` are consolidated so that `src/` has
only `core/`, `modules/`, and minimal entry points (e.g. `cli.ts`, `init.ts`).

Suggested moves from the structural audit:

- `architect/` → `core/architect/`
- `memory/` → `core/memory/`
- `model/` → `core/model/`
- `agent-sdk/` → `core/agent-sdk/`
- `data/` → evaluate: `core/data/` or `modules/data/`
- `mcp/` → `modules/mcp/`
- `server/` → evaluate: `core/server/` or `modules/server/`
- `manifest/` → evaluate: fold into modules or `core/manifest/`
- `web-ui/` → `modules/web-ui/`
- `workflow-testing/` → `core/workflow/testing/`
- `module-testing/` → `core/modules/testing/`
- Loose `.ts` files → sort into appropriate core/ or modules/ subdirectories

## Constraints

- This is a large mechanical refactoring. Break into multiple PRs or sequential
  tasks if needed.
- Update all import paths, `tsconfig` paths, package exports, and `AGENTS.md`
  files after each move.
- Keep `cli.ts` and `init.ts` at the src/ root as entry points if needed.
- Verify typecheck, lint, test, and build pass after each batch of moves.

## Done When

- `src/` contains only `core/`, `modules/`, and minimal entry-point files.
- All import paths and path mappings are updated.
- `src/AGENTS.md` accurately reflects the new structure.
- All checks pass.
