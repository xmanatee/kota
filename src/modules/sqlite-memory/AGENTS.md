# SQLite Memory Extension

This directory owns the `sqlite-memory` built-in extension — alternative SQLite-backed memory provider.

- Registers a SQLite-backed memory provider when `providers.memory` is set to `"sqlite-memory"` in config.
- Data is stored in `.kota/memory.db`.
- Provider implementation lives in `src/memory/sqlite-memory.ts`.

## Files

- `index.ts` — `KotaExtension` definition; registers the SQLite memory provider on load.
