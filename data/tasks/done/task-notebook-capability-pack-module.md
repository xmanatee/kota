---
id: task-notebook-capability-pack-module
title: Move notebook tool into a built-in module capability pack
status: done
priority: p2
area: architecture
summary: The notebook tool (Jupyter notebook read/write/execute) lives in src/core/tools/notebook.ts as a core-hosted tool. Migrating it to src/modules/notebook/ continues the minimal-core migration after the git capability pack.
created_at: 2026-04-08T13:25:00Z
updated_at: 2026-04-08T13:25:00Z
---

## Problem

`src/core/tools/notebook.ts` implements Jupyter notebook operations (read cells, write cells, execute code via kernel). It currently lives in the core tool registry alongside runtime primitives. It is a self-contained capability with no core-protocol tie — there is no reason it needs to live in the core registry.

The web-access, filesystem, execution, and git packs established the pattern: a `src/modules/<name>/` directory with an `index.ts` exporting a `KotaModule`, co-located helpers, and co-located tests.

## Desired Outcome

A `src/modules/notebook/` directory containing:
- `notebook.ts` — the migrated tool implementation (moved from `src/core/tools/notebook.ts`)
- `notebook.test.ts` — co-located tests (moved from `src/core/tools/notebook.test.ts`)
- `index.ts` — exports a `KotaModule` that registers the notebook tool via `onLoad`

The `notebook` registration is removed from `src/core/tools/index.ts`. The module loads unconditionally as a built-in.

`src/core/tools/AGENTS.md` and `src/modules/AGENTS.md` are updated to reflect the new ownership.

## Constraints

- Tool name, schema, and behavior must not change.
- No compatibility aliases or dual-registration paths.
- Follow `src/modules/web-access/` as the reference layout.

## Done When

- `src/modules/notebook/` exists with the migrated tool, tests, and module index.
- `src/core/tools/index.ts` no longer imports or registers the notebook tool.
- `npm test` passes.
- `src/core/tools/AGENTS.md` and `src/modules/AGENTS.md` reflect updated ownership.
