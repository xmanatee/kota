---
id: task-filesystem-capability-pack-module
title: Move filesystem tools into a built-in module capability pack
status: done
priority: p2
area: architecture
summary: file-read, file-write, file-edit, multi-edit, find-replace, glob, grep, file-watch, files-overview, and diff still live in src/tools/ as core-hosted tools. Migrating them to a src/modules/filesystem/ capability pack continues the minimal-core migration started by the web-access module.
created_at: 2026-04-08T00:50:00Z
updated_at: 2026-04-08T02:10:00Z
---

## Problem

The web-access module established the reference pattern for module-owned capability packs: tools, helpers, and tests co-located under `src/modules/<name>/`, with the module registering its tools via `onLoad`. Filesystem I/O is the next cohesive capability family to migrate — it includes the most frequently used tools (`file_read`, `file_write`, `file_edit`, `grep`, `glob`), yet these still live as hardcoded entries in `src/tools/index.ts` and their implementations are scattered across individual files in `src/tools/`.

Leaving filesystem tools in `src/tools/` keeps the core bloated and makes it harder to reason about scope, swap implementations, or test the capability family in isolation.

## Desired Outcome

A `src/modules/filesystem/` directory that owns:
- `file_read`, `file_write`, `file_edit`, `multi_edit`, `find_replace`, `glob`, `grep`, `file_watch`, `files_overview`, `diff` tool implementations
- An `index.ts` that exports a `KotaModule` registering all tools via `onLoad`
- Co-located unit tests for the lifecycle and at least the key tools

The tools are removed from `src/tools/index.ts` core registrations and from `src/tools/` (or kept in `src/tools/` only as shared helpers if the implementation is deeply shared, but registered exclusively via the module). `src/tools/AGENTS.md` is updated to reflect the new home.

## Constraints

- Tool names, schemas, and behavior must not change — this is a pure structural migration.
- No compatibility aliases or dual-registration paths.
- The module must be registered as a built-in module (not user-installed) so it loads unconditionally.
- Follow the `src/modules/web-access/` directory layout as the reference pattern.
- Do not include tools that belong to a different coherent family (e.g., `shell`, `process`, `code_exec`) — those belong in the execution pack.

## Done When

- `src/modules/filesystem/` exists and contains the migrated tools and tests.
- `src/tools/index.ts` no longer imports or hardcodes the migrated tools.
- `npm test` passes.
- `src/tools/AGENTS.md` and `src/modules/AGENTS.md` reflect the updated ownership.
