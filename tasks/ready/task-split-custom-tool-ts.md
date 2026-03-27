---
id: task-split-custom-tool-ts
title: Split tools/custom-tool.ts — extract action handlers into custom-tool-handlers.ts
status: ready
priority: p2
area: code-quality
summary: custom-tool.ts is 285 lines and approaching the 300-line limit. The three CRUD action handlers (handleCreate, handleList, handleRemove) plus the buildRunner execution bridge form a cohesive unit that can move to a new custom-tool-handlers.ts, leaving custom-tool.ts focused on the tool definition schema, registry init, and persistence lifecycle.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/tools/custom-tool.ts` is 285 lines and near the 300-line limit. It mixes the tool schema definition, CRUD action dispatching, three action handler functions, the runtime execution builder, and the persistence lifecycle (loadSavedTools, getCustomToolCount, resetCustomTools). The handler and execution logic is a separable unit.

## Desired Outcome

A new `src/tools/custom-tool-handlers.ts` contains:
- `handleCreate(...)` — validates and registers a new custom tool definition.
- `handleList()` — formats and returns all registered custom tool definitions.
- `handleRemove(...)` — deregisters a custom tool by name.
- `buildRunner(...)` — builds the REPL-backed execution function for a custom tool def.

`src/tools/custom-tool.ts` retains the tool schema, `runCustomTool` dispatcher, `initCustomToolRegistry`, and the persistence lifecycle functions.

## Constraints

- Public exports (`customToolTool`, `runCustomTool`, `initCustomToolRegistry`, `loadSavedTools`, `getCustomToolCount`, `resetCustomTools`, `registration`) must not change import paths.
- All tests and imports must continue to pass without modification.

## Done When

- `src/tools/custom-tool-handlers.ts` exists with the extracted handler and runner logic.
- `src/tools/custom-tool.ts` is measurably shorter (target ≤ 180 lines).
- `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
