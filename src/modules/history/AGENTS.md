# History Module

This directory owns conversation history — the persistent record of past sessions across KOTA.

- Owns the file-based `ConversationHistory` store (`history.ts`, `history-utils.ts`) and the `getHistory` singleton accessor.
- Registers itself as the `"history"` provider during `onLoad` via `ctx.registerProvider("history", getHistory())`. Core resolves the store through `getHistoryProvider()` in `#core/modules/provider-registry.js`; callers outside this module must not import `getHistory` directly.
- Protocol payload types (`ConversationData`, `ConversationRecord`, `ConversationMessage`) live in `#core/modules/provider-types.js`. This module re-exports them from `history-utils.ts` for module-internal convenience only.
- Registers `conversation_recall` in the `management` tool group and contributes the `history` skill (prompt guidance for when and how to use recall).
- Owns the `history` CLI commands (`kota history …`) in `cli-commands.ts` and CLI helpers (interactive REPL, pipe mode, option parsing) in `cli.ts`.
- Owns the `/api/history` HTTP routes.

## Boundaries

- Does not own the memory or knowledge stores (those belong in `memory/` and `knowledge/`).
- CLI-launched sessions use configured autonomy explicitly. Missing session-autonomy config is a boundary error, not a hidden fallback.
- Core must not import from `#modules/history/*`. The repo-wide import guard at `src/core/agent-harness/no-module-imports-in-core.test.ts` enforces the seam for every `#modules/*` subpath.
