Add direct unit tests for `src/memory/working-memory.ts`.

The file exports a session-scoped in-memory scratchpad with explicit capacity limits
(MAX_ENTRIES=20, MAX_VALUE_LENGTH=500, MAX_TOTAL_CHARS=4000). It already exports
`resetWorkingMemory()` for test isolation. All functions are pure in-memory — no
filesystem or async I/O required.

Key surfaces to cover:
- `setEntry`: key-length limit, value-length limit, MAX_ENTRIES full guard, total-chars
  delta guard, new vs update, persistent flag inheritance
- `loadEntries`: bulk load, skips entries that violate limits, returns loaded count
- `getPersistentEntries`: returns only persistent entries
- `getEntry` / `removeEntry` / `listEntries` / `clearAll`
- `getWorkingMemoryState`: empty returns "", renders entries with ★ for persistent
