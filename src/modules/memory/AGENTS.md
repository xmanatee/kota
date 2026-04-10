# Memory Module

This directory owns the `memory` management tool — persistent, searchable agent notes that survive across sessions.

- Registers `memory` in the `management` tool group.
- Contributes the `memory` skill (prompt guidance for saving, searching, and managing memory entries).

## Boundaries

- Does not own the memory storage implementation (that lives in `src/core/memory/`).
- Does not own the `memory` CLI commands (`kota memory …`) — those live in `src/modules/memory/cli.ts`.
- Does not own session-scoped working memory (that belongs in `working-memory/`) or structured knowledge entries (that belongs in `knowledge/`).
- The alternative SQLite-backed memory provider is in `src/modules/sqlite-memory.ts`, not here.
