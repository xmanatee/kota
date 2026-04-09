---
id: task-migrate-store-module-tools
title: Move knowledge, memory, and history tool implementations into their module directories
status: done
priority: p2
area: architecture
summary: The knowledge, memory, and history modules are thin wrappers that import their tool runners from src/tools/. The capability code should move into each module directory to complete the module-first migration and shrink src/tools/.
created_at: 2026-04-08T15:35:00Z
updated_at: 2026-04-08T16:40:00Z
---

## Problem

Three built-in modules are still thin wrappers after the capability pack migrations:

- `src/modules/knowledge/index.ts` imports `knowledgeTool` and `runKnowledge` from `src/tools/knowledge.ts` (and `src/tools/knowledge-schema.ts`)
- `src/modules/memory/index.ts` imports `memoryTool` and `runMemory` from `src/tools/memory.ts`
- `src/modules/history/index.ts` imports `conversationRecallTool` and `runConversationRecall` from `src/tools/conversation-recall.ts`

The implementation files (`knowledge.ts`, `knowledge-schema.ts`, `memory.ts`, `conversation-recall.ts`) each contain hundreds of lines of capability logic that belongs in the module directory alongside the index and tests. This violates the principle documented in ARCHITECTURE.md and `src/modules/AGENTS.md`: capability code should live close to the module that owns it.

`src/tools/AGENTS.md` already instructs that `src/tools/` should not grow with capability packs. The remaining tool files in `src/tools/` that serve these modules are an explicit architecture gap.

## Desired Outcome

- `src/tools/knowledge.ts`, `src/tools/knowledge-schema.ts` → `src/modules/knowledge/`
- `src/tools/memory.ts` → `src/modules/memory/`
- `src/tools/conversation-recall.ts` → `src/modules/history/`

Each module's `index.ts` imports from local files instead of `../../tools/`. All existing tests follow their implementation files into the module directories. `src/tools/AGENTS.md` and `src/modules/AGENTS.md` reflect the final state.

## Constraints

- No behavior changes; this is a pure file relocation.
- Update all import paths in the codebase that reference the moved files.
- Keep `src/tools/index.ts` clean — do not add re-exports for the moved files.
- `working-memory` imports only a type from `src/tools/index.ts`; that import is fine as-is and is out of scope.

## Done When

- `src/tools/` no longer contains `knowledge.ts`, `knowledge-schema.ts`, `memory.ts`, or `conversation-recall.ts`.
- All tests pass after relocation.
- No import in the codebase still references `src/tools/knowledge`, `src/tools/memory`, or `src/tools/conversation-recall`.
- `src/modules/AGENTS.md` inventory entries for these modules are updated to reflect co-located tool files.
