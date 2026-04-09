# Config Module

Owns the `kota config` CLI surface: `get`, `set`, `validate`, and `schema` subcommands.

- Config logic (`loadConfig`, `updateProjectConfig`) stays in `src/config.ts`; only the CLI wiring lives here.
- No runtime state; this module contributes only commands.
