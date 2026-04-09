---
id: task-extract-config-cli-extension
title: Move config-cli.ts into a dedicated config extension
status: ready
priority: p2
area: architecture
summary: src/config-cli.ts (139 lines) implements kota config get/set/list/validate and lives as a standalone core file. Moving it into a new src/extensions/config/ extension continues the operator CLI surface migration.
created_at: 2026-04-09T07:40:09Z
updated_at: 2026-04-09T10:34:06Z
---

## Problem

`src/config-cli.ts` registers `kota config` subcommands (get, set, list, validate) and is
imported directly by `src/cli.ts`. It imports `loadConfig`, `updateProjectConfig`, and
`KNOWN_CONFIG_KEYS` from core. There is no runtime state to own, but the CLI surface is
a natural extension contribution following the same pattern as other migrated CLI files.

## Desired Outcome

A new `src/extensions/config/` extension that:

- Owns `config-cli.ts` logic in `src/extensions/config/index.ts` or `src/extensions/config/cli.ts`
- Registers the `kota config` commands via `ctx.registerCliCommands()`
- Is listed in `builtinExtensions` in `src/extensions/index.ts`

`src/config-cli.ts` is removed and `src/cli.ts` no longer imports from it directly.

## Constraints

- No change to command names, flags, or output.
- Config logic (`loadConfig`, `updateProjectConfig`) stays in `src/config.ts`; only the CLI wiring moves.
- `src/AGENTS.md` Key Modules entry removed; `src/extensions/AGENTS.md` updated with the new entry.

## Done When

- `kota config get/set/list/validate` work identically after the move.
- `src/config-cli.ts` is removed.
- `src/cli.ts` no longer imports `registerConfigCommands`.
- All tests pass.
