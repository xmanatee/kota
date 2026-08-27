---
status: done
---

# Migrate flat module files to per-module subdirectories

## Problem

`src/modules/` mixes two layouts. The recently migrated capability packs
(`web-access/`, `filesystem/`, `execution/`, `git/`, `notebook/`, `read-document/`)
each live in their own subdirectory with co-located tools, helpers, and tests.
The remaining built-in modules are flat files:

- `slack.ts` + `slack.test.ts`
- `telegram.ts` + `telegram.test.ts`
- `webhook.ts` + `webhook.test.ts`
- `working-memory.ts` + `working-memory.test.ts`
- `memory.ts`, `knowledge.ts`, `history.ts`, `scheduler.ts`, `secrets.ts`
- `mcp-server.ts`, `daemon.ts`, `web.ts`
- And others

This makes the directory hard to navigate and inconsistent with the stated target
layout. Modules that grow beyond a single file have no natural home, and tests
are mixed with module source rather than being co-located under a clear owner.

## Desired Outcome

Each built-in module listed above moves into its own subdirectory following the
pattern established by `web-access/`, `git/`, `notebook/`, etc.:

```
src/modules/slack/
  index.ts       (was slack.ts)
  slack.test.ts  (was slack.test.ts)

src/modules/telegram/
  index.ts
  telegram.test.ts

src/modules/webhook/
  index.ts
  webhook.test.ts
...
```

All imports referencing the flat files are updated. The modules barrel
(`src/modules/index.ts`, if any) is updated. Tests continue to pass
without modification to test logic.

## Constraints

- This is a purely mechanical move and import-path update — no logic changes.
- Move in small batches (one or two modules per commit) to keep diffs reviewable.
- Larger modules that have significant core implementation behind them
  (e.g., `mcp-server.ts`, `daemon.ts`) should be scoped separately if the
  implementation lives outside `src/modules/` — do not force-move core
  infrastructure into the module directory.
- Focus first on the channel/notification modules (`slack`, `telegram`,
  `webhook`) and the store adapter modules (`working-memory`, `memory`,
  `knowledge`, `history`) as the highest-value targets.

## Done When

- `slack`, `telegram`, `webhook`, `working-memory`, `memory`, `knowledge`,
  and `history` each live in their own subdirectory under `src/modules/`.
- All internal imports reference the new paths.
- All existing tests for these modules pass.
- `src/modules/` no longer contains flat `.ts` source files for the moved
  modules (test files included).
- `src/modules/AGENTS.md` updated to describe the expected per-directory pattern.
