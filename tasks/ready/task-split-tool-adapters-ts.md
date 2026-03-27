---
id: task-split-tool-adapters-ts
title: Split tool-adapters.ts — extract external format types into tool-adapter-types.ts
status: ready
priority: p2
area: refactor
summary: tool-adapters.ts is 265 lines with a clear "External format types" section (SimpleTool, OpenAIFunctionTool, VercelAITool) at the top followed by the adapter functions. Extracting the types gives consumers a lightweight import path and keeps each file focused.
created_at: 2026-03-27T12:31:00Z
updated_at: 2026-03-27T12:31:00Z
---

## Problem

`tool-adapters.ts` (265 lines) mixes external-format type definitions with adapter conversion functions. Consumers that only need to construct or type-check tool objects must import from the adapter file, pulling in conversion logic they do not use.

## Desired Outcome

A new `tool-adapter-types.ts` contains `SimpleTool`, `OpenAIFunctionTool`, and `VercelAITool`. `tool-adapters.ts` imports from it and re-exports those types for backwards compatibility. Both files stay well under 300 lines.

## Constraints

- No behaviour changes — only a structural split.
- `tool-adapters.ts` must re-export the types so existing importers need no changes.
- Update `src/AGENTS.md` Key Modules if either file is listed there.

## Done When

- `tool-adapter-types.ts` exists and contains the three external format types.
- `tool-adapters.ts` imports from `tool-adapter-types.ts` and re-exports those types.
- All existing tests pass.
- Both files are under 300 lines.
