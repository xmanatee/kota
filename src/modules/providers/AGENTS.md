# Providers Module

Owns the `ProviderRegistry` class and all singleton accessors for KOTA's swappable service backends (memory, knowledge, task, history).

- `ProviderRegistry` — register, get, set-active, list, and clear provider entries by type.
- Singleton functions: `initProviderRegistry`, `getProviderRegistry`, `resetProviderRegistry`.
- `registerDefaultProviders` — wires up the in-process default stores for all four service types.
- Convenience getters: `getMemoryProvider`, `getKnowledgeProvider`, `getTaskProvider`, `getHistoryProvider` — each falls back to the in-process default store if no registry or no registered provider.

Provider interface definitions stay in `src/provider-types.ts`; this module re-exports them for single-import convenience. Concrete provider implementations live in their owning modules (e.g. `sqlite-memory`, `history`, `knowledge`, `memory`).
