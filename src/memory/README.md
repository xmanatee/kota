# Memory Subsystem

Persistent and session-scoped data stores for the agent.

## Files

| File | Purpose |
|------|---------|
| `store.ts` | `MemoryStore` — file-based persistent memory (markdown + YAML front matter) |
| `working-memory.ts` | In-memory key-value store for session-scoped scratchpad entries |
| `sqlite-memory.ts` | `SQLiteMemoryProvider` — alternative memory backend using SQLite |
| `knowledge-store.ts` | `KnowledgeStore` — structured knowledge entries with tags and search |
| `compaction.ts` | Context compaction — summarizes old messages to stay within token budget |
| `history.ts` | `ConversationHistory` — persists past conversation records |

## Dependencies

- `store.ts`, `working-memory.ts`, `knowledge-store.ts`, `history.ts` are standalone
- `sqlite-memory.ts` depends on `store.ts` (Memory type) and `../providers.ts`
- `compaction.ts` depends on `../model-client.ts`
