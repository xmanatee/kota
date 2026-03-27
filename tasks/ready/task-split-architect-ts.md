---
id: task-split-architect-ts
title: Split architect.ts — extract editor loop into architect-editor.ts
status: ready
priority: p2
area: refactor
summary: architect.ts is 272 lines mixing the architect (planner) pass and the editor (executor) loop. Extracting the editor loop and its types/constants into architect-editor.ts gives each role its own file and keeps both under 300 lines.
created_at: 2026-03-27T12:20:00Z
updated_at: 2026-03-27T12:35:56Z
---

## Problem

`src/architect/architect.ts` (272 lines) contains two distinct roles:
- `runArchitectPass` — the planner that produces an execution plan
- `runEditorLoop` — the executor that carries out the plan using tools

These roles have separate system prompts, separate option/result types, and separate logic. Mixing them in one file obscures the boundary between planning and execution.

## Desired Outcome

Extract the editor loop into `src/architect/architect-editor.ts`:
- Move `EDITOR_SYSTEM`, `EDITOR_TOOL_SET`, `MAX_EDITOR_TURNS`, `EDITOR_RESULT_LIMIT`, `EditorOptions`, `EditorResult`, and `runEditorLoop` into the new file.
- Keep `architect.ts` with `ARCHITECT_SYSTEM`, `STREAM_MAX_RETRIES`, `streamBackoff`, `ArchitectOptions`, and `runArchitectPass`.
- Update all import sites to reference the correct file.

## Constraints

- Do not change any logic, only move code.
- All existing exports must remain importable from their new locations.
- Keep `streamBackoff` and `STREAM_MAX_RETRIES` in `architect.ts`; they can be imported by `architect-editor.ts` if needed, or duplicated if the duplication is small and cleaner.

## Done When

- `architect-editor.ts` exists with the editor loop and its types
- `architect.ts` contains only the architect pass and shared utilities
- Both files are under 300 lines (architect.ts will be ~90 lines; architect-editor.ts will be ~200 lines)
- All imports across the codebase compile without errors
- Tests pass
