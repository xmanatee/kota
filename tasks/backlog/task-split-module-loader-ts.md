---
id: task-split-module-loader-ts
title: Split module-loader.ts — extract lifecycle and dependency resolution
status: backlog
priority: p3
area: structure
summary: module-loader.ts is 525 lines, 75% over the 300-line limit. It handles dependency sorting, module lifecycle, tool/command/route registration, and event wiring in one class. Splitting improves navigability.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/module-loader.ts` is 525 lines (75% over the 300-line limit). The `ModuleLoader` class contains:
- Topological sort / dependency resolution
- Module lifecycle (load, unload, error recovery)
- Tool, command, and route registration
- Event bus wiring

These are separable concerns currently bundled in one file.

## Desired Outcome

`module-loader.ts` shrinks to ≤300 lines. A natural split point is extracting the topological sort into a small `module-deps.ts` or similar. No behavior changes.

## Constraints

- `ModuleLoader` must remain the public export from `module-loader.ts` or be re-exported from it.
- No changes to the `KotaModule` protocol or `module-types.ts` public surface.
- All tests must pass after the split.

## Done When

- `module-loader.ts` is ≤300 lines.
- The extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
