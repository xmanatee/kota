# SQLite Memory Module

This directory owns the `sqlite-memory` repo module — alternative SQLite-backed memory provider.

- Registers a SQLite-backed memory provider when `providers.memory` is set to `"sqlite-memory"` in config.
- Data is stored in `.kota/memory.db`.
- Provider implementation lives in `src/core/memory/sqlite-memory.ts`.

