# Providers Extension

Owns the `ProviderRegistry` class and all singleton accessors for KOTA's swappable service backends (memory, knowledge, task, history).

- `ProviderRegistry` — register, get, set-active, list, and clear provider entries by type.
- Singleton functions: `initProviderRegistry`, `getProviderRegistry`, `resetProviderRegistry`.
- `registerDefaultProviders` — wires up built-in stores as the default providers for all four service types.
- Convenience getters: `getMemoryProvider`, `getKnowledgeProvider`, `getTaskProvider`, `getHistoryProvider` — each falls back to the built-in store if no registry or no registered provider.

Provider interface definitions stay in `src/provider-types.ts`; this extension re-exports them for single-import convenience. Concrete provider implementations live in their owning extensions (e.g. `sqlite-memory`, `history`, `knowledge`, `memory`).
