---
id: task-move-extension-cli-into-extension
title: Move kota extension CLI commands out of core into an owning extension
status: done
priority: p2
area: architecture
summary: src/extension-cli.ts (446 lines) registers all kota extension subcommands but lives in core src/ rather than in an owning extension. Moving it closes the last large CLI surface still imported directly from core cli.ts.
created_at: 2026-04-09T06:19:00Z
updated_at: 2026-04-09T06:19:00Z
---

## Problem

`src/extension-cli.ts` (446 lines) provides `kota extension list`, `kota extension inspect`,
`kota extension create`, `kota extension add`, and `kota extension remove` subcommands. It
is imported directly from `src/cli.ts` via `registerExtensionCommands`. This is the same
pattern that was recently cleaned up for approval, audit, task, scheduling, and agent/skill
commands — all of which moved into their owning extension directories.

`src/extensions/registry/index.ts` currently owns the `kota tools` CLI surface for external
tool package management. The extension lifecycle CLI could live alongside it or in its own
dedicated extension, but either way it should not remain in core.

## Desired Outcome

`src/extension-cli.ts` is removed. Its content moves into `src/extensions/registry/` (if the
scope is a natural fit) or a new `src/extensions/extension-manager/` extension that contributes
the `kota extension` CLI surface as part of its `init` hook.

`src/cli.ts` no longer imports from `extension-cli.ts`. The extension itself registers the
`kota extension` command via its `init(ctx)` or `commands` contribution.

## Constraints

- No change to `kota extension` CLI behavior or flags.
- All `kota extension` subcommands work identically after the move.
- The scaffold generators (TypeScript and Python) move with the CLI code, not separately.
- `src/cli.ts` is the only consumer that should need updating.

## Done When

- `src/extension-cli.ts` is deleted.
- `kota extension list`, `inspect`, `create`, `add`, and `remove` all work via the extension's contribution.
- `src/cli.ts` no longer imports from `extension-cli.ts`.
- Tests that cover extension CLI behavior pass.
