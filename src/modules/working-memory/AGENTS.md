# Working Memory Module

This directory owns the working memory module — a session-scoped, agent-controlled scratchpad whose entries appear in the system prompt every turn.

- Unlike the `memory` module (persistent cross-session notes) and `knowledge` module (structured reference data), working memory is visible without explicit reads and is cleared when the session ends.
- Named entries can be persisted across sessions by marking them persistent; those are saved via `ModuleStorage`.
- Contributes the `working-memory` skill (prompt guidance for managing entries).

## Boundaries

- Owns the session-scoped working-memory store implementation (`store.ts`); the
  module's tool runner and dynamic state provider delegate to it directly.
- Does not own persistent cross-session memory (that belongs in `memory/`) or structured reference entries (that belongs in `knowledge/`).
- Does not own conversation recall (that belongs in `history/`).
