# Stores

This directory implements the runtime state subsystem: the typed stores that
hold persistent and session-scoped agent data.

- Store types are: history, memory, knowledge, working memory, and (separately)
  run artifacts. See `docs/STORES.md` for scope, lifetime, and access patterns.
- `compaction.ts` is co-located here because it operates on session context, but
  it is not a store — it belongs to the session loop.
- Keep storage behavior explicit and durable. Don't add implicit persistence or
  auto-sync logic.
- Update `README.md` and `docs/STORES.md` if persistence semantics change.
