# Config Module

Owns the `kota config` CLI surface: `get`, `set`, `validate`, and `schema` subcommands.

- Config logic stays in `src/config.ts`; only the CLI wiring and HTTP routes live here.
- The HTTP route masks sensitive keys before returning.
