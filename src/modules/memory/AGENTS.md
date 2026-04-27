# Memory Module

This directory owns persistent, searchable agent notes that survive across sessions.

- Owns the file-based `MemoryStore` implementation (`store.ts`) and registers it as the `default` memory provider at module load through the provider registry.
- Contributes the `memory` tool in the `management` group, the `kota memory …` CLI commands, the `/api/memory` HTTP routes, and the `memory` skill.
- Operator pull-surfaces consume the search seam through one shared HTTP route (`GET /api/memory/search`) and one shared line shape (`renderMemorySearchPlain`): Telegram `/memory`, terminal `kota memory search`, and the macOS menu bar `MemoryView`.

## Boundaries

- Does not own session-scoped working memory (that belongs in `src/modules/working-memory/`) or structured knowledge entries (that belongs in `src/modules/knowledge/`).
- The alternative SQLite-backed memory provider is in `src/modules/sqlite-memory/`, not here.
- The embedding-backed memory provider is in `src/modules/memory-semantic/`, which layers on top of this module's store.
