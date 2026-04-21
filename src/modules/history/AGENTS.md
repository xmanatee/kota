# History Module

This directory owns conversation history — the persistent record of past sessions across KOTA.

- Owns the file-based `ConversationHistory` store (`history.ts`, `history-utils.ts`) and the `getHistory` singleton accessor. External callers import it via `#modules/history/history.js`.
- Registers `conversation_recall` in the `management` tool group and contributes the `history` skill (prompt guidance for when and how to use recall).
- Owns the `history` CLI commands (`kota history …`) in `cli-commands.ts` and CLI helpers (interactive REPL, pipe mode, option parsing) in `cli.ts`.
- Owns the `/api/history` HTTP routes.

## Boundaries

- Does not own the memory or knowledge stores (those belong in `memory/` and `knowledge/`).
- CLI-launched sessions use configured autonomy explicitly. Missing session-autonomy config is a boundary error, not a hidden fallback.
