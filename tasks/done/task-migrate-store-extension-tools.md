---
id: task-migrate-store-extension-tools
title: Move knowledge, memory, and history tool implementations into their extension directories
status: done
priority: p2
area: architecture
summary: The knowledge, memory, and history extensions are thin wrappers that import their tool runners from src/tools/. The capability code should move into each extension directory to complete the extension-first migration and shrink src/tools/.
created_at: 2026-04-08T15:35:00Z
updated_at: 2026-04-08T16:40:00Z
---

## Problem

Three built-in extensions are still thin wrappers after the capability pack migrations:

- `src/extensions/knowledge/index.ts` imports `knowledgeTool` and `runKnowledge` from `src/tools/knowledge.ts` (and `src/tools/knowledge-schema.ts`)
- `src/extensions/memory/index.ts` imports `memoryTool` and `runMemory` from `src/tools/memory.ts`
- `src/extensions/history/index.ts` imports `conversationRecallTool` and `runConversationRecall` from `src/tools/conversation-recall.ts`

The implementation files (`knowledge.ts`, `knowledge-schema.ts`, `memory.ts`, `conversation-recall.ts`) each contain hundreds of lines of capability logic that belongs in the extension directory alongside the index and tests. This violates the principle documented in ARCHITECTURE.md and `src/extensions/AGENTS.md`: capability code should live close to the extension that owns it.

`src/tools/AGENTS.md` already instructs that `src/tools/` should not grow with capability packs. The remaining tool files in `src/tools/` that serve these extensions are an explicit architecture gap.

## Desired Outcome

- `src/tools/knowledge.ts`, `src/tools/knowledge-schema.ts` → `src/extensions/knowledge/`
- `src/tools/memory.ts` → `src/extensions/memory/`
- `src/tools/conversation-recall.ts` → `src/extensions/history/`

Each extension's `index.ts` imports from local files instead of `../../tools/`. All existing tests follow their implementation files into the extension directories. `src/tools/AGENTS.md` and `src/extensions/AGENTS.md` reflect the final state.

## Constraints

- No behavior changes; this is a pure file relocation.
- Update all import paths in the codebase that reference the moved files.
- Keep `src/tools/index.ts` clean — do not add re-exports for the moved files.
- `working-memory` imports only a type from `src/tools/index.ts`; that import is fine as-is and is out of scope.

## Done When

- `src/tools/` no longer contains `knowledge.ts`, `knowledge-schema.ts`, `memory.ts`, or `conversation-recall.ts`.
- All tests pass after relocation.
- No import in the codebase still references `src/tools/knowledge`, `src/tools/memory`, or `src/tools/conversation-recall`.
- `src/extensions/AGENTS.md` inventory entries for these extensions are updated to reflect co-located tool files.
