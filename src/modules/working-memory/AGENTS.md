# Working Memory Module

This directory owns the working memory module — a session-scoped, agent-controlled scratchpad whose entries appear in the system prompt every turn.

- Unlike the `memory` module (persistent cross-session notes) and `knowledge` module (structured reference data), working memory is visible without explicit reads and is cleared when the session ends.
- Named entries can be persisted across sessions by marking them persistent; those are saved via `ModuleStorage`.
- Contributes the `working-memory` skill (prompt guidance for managing entries).

## Files

- `index.ts` — `KotaModule` definition; registers working memory tools, prompt injection, and persistent entry restore on load.
- `working-memory.test.ts` — unit tests for tool operations and prompt injection.

## Boundaries

- Tool implementations delegate to `src/core/memory/working-memory.ts`; that module is the canonical data structure.
- Does not own persistent cross-session memory (that belongs in `memory/`) or structured reference entries (that belongs in `knowledge/`).
- Does not own conversation recall (that belongs in `history/`).
