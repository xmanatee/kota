# History Module

This directory owns the `conversation_recall` management tool — lets the agent search and read past conversations across sessions.

- Registers `conversation_recall` in the `management` tool group.
- Contributes the `history` skill (prompt guidance for when and how to use recall).

## Boundaries

- Does not own the history storage implementation (that lives in `src/core/memory/`).
- Owns the `history` CLI commands (`kota history …`) in `cli-commands.ts` and
  CLI helpers (interactive REPL, pipe mode, option parsing) in `cli.ts`.
- Does not own the memory or knowledge stores (those belong in `memory/` and `knowledge/`).
