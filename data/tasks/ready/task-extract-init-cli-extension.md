---
id: task-extract-init-cli-extension
title: Move init-cli.ts into a dedicated init extension
status: ready
priority: p2
area: architecture
summary: src/init-cli.ts (174 lines) implements kota init and is imported directly by src/cli.ts. Moving it into a src/extensions/init/ extension continues the operator CLI surface migration.
created_at: 2026-04-09T10:47:41Z
updated_at: 2026-04-09T12:30:00Z
---

## Problem

`src/init-cli.ts` registers the `kota init` command, which scaffolds a new KOTA project
with config, task directories, docs stubs, and `.kota/`. It is imported directly by
`src/cli.ts`. Like other operator CLI surfaces, it belongs in an extension.

## Desired Outcome

A new `src/extensions/init/` extension that:

- Owns `init-cli.ts` logic (`runInit`, `registerInitCommand`)
- Registers `kota init` via `ctx.registerCliCommands()`
- Is listed in `builtinExtensions` in `src/extensions/index.ts`

`src/init-cli.ts` is removed. `src/cli.ts` no longer imports from it.

## Constraints

- No change to command name, flags, or scaffolded output.
- `src/AGENTS.md` Key Modules entry removed; `src/extensions/AGENTS.md` updated.

## Done When

- `kota init` scaffolds identically after the move.
- `src/init-cli.ts` is removed.
- `src/cli.ts` no longer imports `registerInitCommand`.
- All tests pass.
