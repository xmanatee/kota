---
id: task-move-module-cli-into-module
title: Move kota module CLI commands out of core into an owning module
status: done
priority: p2
area: architecture
summary: src/module-cli.ts (446 lines) registers all kota module subcommands but lives in core src/ rather than in an owning module. Moving it closes the last large CLI surface still imported directly from core cli.ts.
created_at: 2026-04-09T06:19:00Z
updated_at: 2026-04-09T06:19:00Z
---

## Problem

`src/module-cli.ts` (446 lines) provides `kota module list`, `kota module inspect`,
`kota module create`, `kota module add`, and `kota module remove` subcommands. It
is imported directly from `src/cli.ts` via `registerExtensionCommands`. This is the same
pattern that was recently cleaned up for approval, audit, task, scheduling, and agent/skill
commands — all of which moved into their owning module directories.

`src/modules/registry/index.ts` currently owns the `kota tools` CLI surface for external
tool package management. The module lifecycle CLI could live alongside it or in its own
dedicated module, but either way it should not remain in core.

## Desired Outcome

`src/module-cli.ts` is removed. Its content moves into `src/modules/registry/` (if the
scope is a natural fit) or a new `src/modules/module-manager/` module that contributes
the `kota module` CLI surface as part of its `init` hook.

`src/cli.ts` no longer imports from `module-cli.ts`. The module itself registers the
`kota module` command via its `init(ctx)` or `commands` contribution.

## Constraints

- No change to `kota module` CLI behavior or flags.
- All `kota module` subcommands work identically after the move.
- The scaffold generators (TypeScript and Python) move with the CLI code, not separately.
- `src/cli.ts` is the only consumer that should need updating.

## Done When

- `src/module-cli.ts` is deleted.
- `kota module list`, `inspect`, `create`, `add`, and `remove` all work via the module's contribution.
- `src/cli.ts` no longer imports from `module-cli.ts`.
- Tests that cover module CLI behavior pass.
