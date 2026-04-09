# Memory Module

This directory owns the `memory` management tool — persistent, searchable agent notes that survive across sessions.

- Registers `memory` in the `management` tool group.
- Contributes the `memory` skill (prompt guidance for saving, searching, and managing memory entries).

## Files

- `index.ts` — `KotaModule` definition; registers the tool and skill.
- `memory.ts` — `memoryTool` schema and `runMemory` runner (save/search/list/update/delete operations).
- `memory.test.ts` — unit tests for memory operations.

## Boundaries

- Does not own the memory storage implementation (that lives in `src/memory/`).
- Does not own the `memory` CLI commands (`kota memory …`) — those live in `src/memory-cli.ts`.
- Does not own session-scoped working memory (that belongs in `working-memory/`) or structured knowledge entries (that belongs in `knowledge/`).
- The alternative SQLite-backed memory provider is in `src/modules/sqlite-memory.ts`, not here.
