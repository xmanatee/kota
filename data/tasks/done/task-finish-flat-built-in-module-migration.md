---
id: task-finish-flat-built-in-module-migration
title: Finish migrating remaining flat built-in modules into per-module directories
status: done
priority: p1
area: architecture
summary: The repo still reads flatter than the target module-owned shape because several built-in modules still live as top-level files under src/modules/. Move the remaining real modules behind per-module directories so src/modules/ mostly contains directories plus explicitly shared utilities.
created_at: 2026-04-08T16:30:00Z
updated_at: 2026-04-08T17:15:29Z
---

## Problem

Recent work moved many capability packs into module-owned directories, but
`src/modules/` still contains several built-in modules as flat top-level
files (`daemon.ts`, `web.ts`, `scheduler.ts`, `mcp-server.ts`, `secrets.ts`,
`sqlite-memory.ts`, `tool-cache.ts`, `tool-retry.ts`, `vercel-adapter.ts`,
`registry.ts`). That leaves the module layer visually and structurally flat,
which undercuts the main architectural goal: a small core with plug-and-play
modules that own their own entrypoint, helpers, tests, and docs.

Because this remaining debt is still visible in the repo shape, explorer keeps
drifting toward secondary work too early. The architecture cleanup is not
actually finished yet.

## Desired Outcome

The remaining real built-in modules move to per-module directories under
`src/modules/<name>/`, each with a local `index.ts` entrypoint and
co-located helpers/tests where appropriate. After the change, the top level of
`src/modules/` is reserved for the aggregator and explicitly shared utility
files only.

`src/modules/index.ts`, local `AGENTS.md` docs, and any related architecture
docs reflect the final ownership shape honestly.

## Constraints

- Keep the core/runtime contracts unchanged; this is an ownership/layout
  cleanup, not a redesign of module protocols.
- Shared helpers that are truly cross-module utilities may remain at the
  top level, but they should be clearly justified as utilities rather than
  module entrypoints.
- Do not leave compatibility shims or duplicate entry surfaces behind.
- Preserve tests and behavior while moving files.

## Done When

- The remaining built-in module entrypoints listed above no longer live as
  flat top-level source files in `src/modules/`.
- Each moved module has a dedicated directory with an `index.ts` entrypoint.
- `src/modules/` reads primarily as module directories plus a small,
  explicit set of shared utilities.
- `src/modules/index.ts`, `src/modules/AGENTS.md`, and
  `docs/ARCHITECTURE.md` match the resulting shape.
- Typecheck, lint, test, and build remain green.
