# History Module

This directory owns conversation history — the persistent record of past sessions across KOTA.

- Owns the file-based `ConversationHistory` store (`history.ts`, `history-utils.ts`) and the `getHistory` singleton accessor.
- Registers itself as the `"history"` provider during `onLoad` via `ctx.registerProvider("history", getHistory())`. Core resolves the store through `getHistoryProvider()` in `#core/modules/provider-registry.js`; callers outside this module must not import `getHistory` directly.
- Protocol payload types (`ConversationData`, `ConversationRecord`, `ConversationMessage`) live in `#core/modules/provider-types.js`. This module re-exports them from `history-utils.ts` for module-internal convenience only.
- Registers `conversation_recall` in the `management` tool group and contributes the `history` skill (prompt guidance for when and how to use recall).
- Owns the `history` CLI commands (`kota history …`) in `cli-commands.ts` and CLI helpers (interactive REPL, pipe mode, option parsing) in `cli.ts`.
- Owns the `/api/history` HTTP routes (kota serve) and the `/history`,
  `/history/:id` daemon-control routes contributed via
  `KotaModule.controlRoutes`. The two GETs run under capability scope `read`;
  the DELETE under `control`. Both surfaces share local-only access
  helpers in `routes.ts` so the wire contract (`{ conversations: ... }`,
  full record on get, `204` on delete, `404` on missing) stays in one place.
- Operator pull-surfaces consume the search seam through one shared HTTP route (`GET /api/history/search`) and one shared line shape (`renderHistorySearchPlain`): Telegram `/history`, terminal `kota history search`, and the macOS menu bar `HistoryView`.

## Boundaries

- Does not own the memory or knowledge stores (those belong in `memory/` and `knowledge/`).
- The embedding-backed history provider is in `src/modules/history-semantic/`,
  which layers on top of this module's store. Modules that consume the history
  store at runtime (currently `history-semantic`) must list `history` in their
  KotaModule `dependencies` so the loader orders onLoad correctly.
- CLI-launched sessions use configured autonomy explicitly. Missing session-autonomy config is a boundary error, not a hidden fallback.
- Core must not import from `#modules/history/*`. The repo-wide import guard at `src/core/agent-harness/no-module-imports-in-core.test.ts` enforces the seam for every `#modules/*` subpath.
