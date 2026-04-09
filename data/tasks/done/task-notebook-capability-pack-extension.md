---
id: task-notebook-capability-pack-extension
title: Move notebook tool into a built-in extension capability pack
status: done
priority: p2
area: architecture
summary: The notebook tool (Jupyter notebook read/write/execute) lives in src/tools/notebook.ts as a core-hosted tool. Migrating it to src/extensions/notebook/ continues the minimal-core migration after the git capability pack.
created_at: 2026-04-08T13:25:00Z
updated_at: 2026-04-08T13:25:00Z
---

## Problem

`src/tools/notebook.ts` implements Jupyter notebook operations (read cells, write cells, execute code via kernel). It currently lives in the core tool registry alongside runtime primitives. It is a self-contained capability with no core-protocol tie — there is no reason it needs to live in the core registry.

The web-access, filesystem, execution, and git packs established the pattern: a `src/extensions/<name>/` directory with an `index.ts` exporting a `KotaExtension`, co-located helpers, and co-located tests.

## Desired Outcome

A `src/extensions/notebook/` directory containing:
- `notebook.ts` — the migrated tool implementation (moved from `src/tools/notebook.ts`)
- `notebook.test.ts` — co-located tests (moved from `src/tools/notebook.test.ts`)
- `index.ts` — exports a `KotaExtension` that registers the notebook tool via `onLoad`

The `notebook` registration is removed from `src/tools/index.ts`. The extension loads unconditionally as a built-in.

`src/tools/AGENTS.md` and `src/extensions/AGENTS.md` are updated to reflect the new ownership.

## Constraints

- Tool name, schema, and behavior must not change.
- No compatibility aliases or dual-registration paths.
- Follow `src/extensions/web-access/` as the reference layout.

## Done When

- `src/extensions/notebook/` exists with the migrated tool, tests, and extension index.
- `src/tools/index.ts` no longer imports or registers the notebook tool.
- `npm test` passes.
- `src/tools/AGENTS.md` and `src/extensions/AGENTS.md` reflect updated ownership.
