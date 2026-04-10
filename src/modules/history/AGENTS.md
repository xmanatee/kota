# History Module

This directory owns the `conversation_recall` management tool — lets the agent search and read past conversations across sessions.

- Registers `conversation_recall` in the `management` tool group.
- Contributes the `history` skill (prompt guidance for when and how to use recall).

## Files

- `index.ts` — `KotaModule` definition; registers the tool, skill, and HTTP routes.
- `conversation-recall.ts` — `conversationRecallTool` schema and `runConversationRecall` runner.
- `conversation-recall.test.ts` — unit tests for recall search and read operations.
- `routes.ts` — HTTP route handlers for `/api/history`, `/api/history/:conversationId`; contributed via `KotaModule.routes` (proxy-capable via `DaemonControlClient`).
- `routes.test.ts` — unit tests for the HTTP route handlers (if added).

## Boundaries

- Does not own the history storage implementation (that lives in `src/memory/`).
- Does not own the `history` CLI commands (`kota history …`) — those live in `src/cli-history-commands.ts`.
- Does not own the memory or knowledge stores (those belong in `memory/` and `knowledge/`).
