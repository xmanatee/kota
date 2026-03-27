# Stores

Persistent and session-scoped data stores for the agent. See `docs/STORES.md`
for the full store model, scope summary, and guidance on which store to use.

## Files

| File | Store | Notes |
|------|-------|-------|
| `history.ts` | History | Persistent conversation records, global scope |
| `store.ts` | Memory | Persistent agent notes, global scope, 100-entry limit |
| `sqlite-memory.ts` | Memory (alt) | SQLite-backed memory provider, no entry limit |
| `knowledge-store.ts` | Knowledge | Structured entries with tags and search, project or global |
| `working-memory.ts` | Working Memory | Session-scoped scratchpad, injected into system prompt |
| `compaction.ts` | — | Context compaction logic (not a store; used by session loop) |

## Dependencies

- `store.ts`, `working-memory.ts`, `knowledge-store.ts`, `history.ts` are standalone
- `sqlite-memory.ts` depends on `store.ts` (Memory type) and `../providers.ts`
- `compaction.ts` depends on `../model-client.ts`
