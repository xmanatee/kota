---
id: task-extension-per-directory-layout
title: Migrate flat extension files to per-extension subdirectories
status: done
priority: p1
area: extensions
summary: Several built-in extensions in src/extensions/ are single flat files (slack.ts, telegram.ts, webhook.ts, memory.ts, etc.) rather than per-extension subdirectories. Migrating them to the directory pattern used by the recently migrated capability packs makes ownership, co-location, and future growth consistent.
created_at: 2026-04-08T14:20:00Z
updated_at: 2026-04-08T14:45:00Z
---

## Problem

`src/extensions/` mixes two layouts. The recently migrated capability packs
(`web-access/`, `filesystem/`, `execution/`, `git/`, `notebook/`, `read-document/`)
each live in their own subdirectory with co-located tools, helpers, and tests.
The remaining built-in extensions are flat files:

- `slack.ts` + `slack.test.ts`
- `telegram.ts` + `telegram.test.ts`
- `webhook.ts` + `webhook.test.ts`
- `working-memory.ts` + `working-memory.test.ts`
- `memory.ts`, `knowledge.ts`, `history.ts`, `scheduler.ts`, `secrets.ts`
- `mcp-server.ts`, `daemon.ts`, `web.ts`
- And others

This makes the directory hard to navigate and inconsistent with the stated target
layout. Extensions that grow beyond a single file have no natural home, and tests
are mixed with extension source rather than being co-located under a clear owner.

## Desired Outcome

Each built-in extension listed above moves into its own subdirectory following the
pattern established by `web-access/`, `git/`, `notebook/`, etc.:

```
src/extensions/slack/
  index.ts       (was slack.ts)
  slack.test.ts  (was slack.test.ts)

src/extensions/telegram/
  index.ts
  telegram.test.ts

src/extensions/webhook/
  index.ts
  webhook.test.ts
...
```

All imports referencing the flat files are updated. The extensions barrel
(`src/extensions/index.ts`, if any) is updated. Tests continue to pass
without modification to test logic.

## Constraints

- This is a purely mechanical move and import-path update — no logic changes.
- Move in small batches (one or two extensions per commit) to keep diffs reviewable.
- Larger extensions that have significant core implementation behind them
  (e.g., `mcp-server.ts`, `daemon.ts`) should be scoped separately if the
  implementation lives outside `src/extensions/` — do not force-move core
  infrastructure into the extension directory.
- Focus first on the channel/notification extensions (`slack`, `telegram`,
  `webhook`) and the store adapter extensions (`working-memory`, `memory`,
  `knowledge`, `history`) as the highest-value targets.

## Done When

- `slack`, `telegram`, `webhook`, `working-memory`, `memory`, `knowledge`,
  and `history` each live in their own subdirectory under `src/extensions/`.
- All internal imports reference the new paths.
- All existing tests for these extensions pass.
- `src/extensions/` no longer contains flat `.ts` source files for the moved
  extensions (test files included).
- `src/extensions/AGENTS.md` updated to describe the expected per-directory pattern.
