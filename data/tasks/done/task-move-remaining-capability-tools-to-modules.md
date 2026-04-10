---
id: task-move-remaining-capability-tools-to-modules
title: Move remaining general-purpose capability tools from core into their owning modules
status: done
priority: p2
area: architecture
summary: Three general-purpose capability implementations still live in core src/ despite being fully owned by specific modules; moving them closes the last visible gap in the module-first capability migration.
created_at: 2026-04-08T21:30:00Z
updated_at: 2026-04-08T21:30:00Z
---

## Problem

The module-first architecture migration is nearly complete, but three capability
implementations remain stranded in the wrong place:

1. `src/tool-cache.ts` — the cache middleware implementation lives in the core root.
   Its only non-test importer is `src/modules/tool-cache/index.ts`, which is a
   thin registration wrapper around it. The implementation belongs in the module
   directory, not the core root.

2. `src/core/tools/notify.ts` — the `notify` tool sends desktop notifications and belongs
   in the `system` capability module alongside `clipboard`, `view_image`, and
   `env_info`. It is currently registered from the core tools bucket.

3. `src/core/tools/repo-map.ts` — the `repo_map` tool does source code structure analysis
   using glob and symbol scanning. It belongs in the `filesystem` capability module
   alongside `glob`, `grep`, and `files_overview`.

`src/core/tools/AGENTS.md` explicitly says general-purpose capability packs belong in
`src/modules/`, and the `notify` / `repo_map` tools were called out as exceptions
that should be moved. `src/modules/AGENTS.md` says to prefer real ownership over
thin wrappers.

## Desired Outcome

- `src/tool-cache.ts` → `src/modules/tool-cache/cache.ts` (or similar); the
  module `index.ts` imports from the local path instead of `../../tool-cache.js`.
  The old `src/tool-cache.ts` is removed.

- `src/core/tools/notify.ts` → `src/modules/system/notify.ts`; the system module
  registers the `notify` tool. Core `src/core/tools/index.ts` no longer imports it.

- `src/core/tools/repo-map.ts` → `src/modules/filesystem/repo-map.ts`; the filesystem
  module registers the `repo_map` tool. Core `src/core/tools/index.ts` no longer imports it.

- `src/modules/AGENTS.md` entries for `system/index.ts` and `filesystem/index.ts`
  updated to mention the newly added tools.

- No behavior changes; tool names, schemas, and outputs remain identical.

## Constraints

- `src/tool-retry.ts` is excluded: `delegate-turn.ts` imports `maybeRetry` from it,
  creating a core dependency. Leave that for a separate task.
- No changes to tool names, schemas, risk classification, or group assignments.
- All existing tests must pass after the move; co-locate any moved tool tests with
  their new module directory.
- Do not modify the `KotaModule` interface or any provider protocol.

## Done When

- `src/tool-cache.ts` no longer exists; implementation lives in `src/modules/tool-cache/`.
- `src/core/tools/notify.ts` no longer exists; `notify` tool registered by system module.
- `src/core/tools/repo-map.ts` no longer exists; `repo_map` tool registered by filesystem module.
- All tests pass; no behavior regressions.
- `src/modules/AGENTS.md` updated for system and filesystem module entries.
