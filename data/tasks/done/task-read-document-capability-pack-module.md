---
id: task-read-document-capability-pack-module
title: Move read-document tool into a built-in module capability pack
status: done
priority: p2
area: architecture
summary: The read-document tool (PDF, DOCX, EPUB, and other format extraction) lives in src/core/tools/read-document.ts with a co-located extractors file. Migrating to src/modules/read-document/ continues the minimal-core migration after the notebook capability pack.
created_at: 2026-04-08T13:25:00Z
updated_at: 2026-04-08T14:54:00Z
---

## Problem

`src/core/tools/read-document.ts` and `src/core/tools/read-document-extractors.ts` implement document content extraction (PDF, DOCX, EPUB, HTML). These files are self-contained — no core-protocol dependency — and belong in an module capability pack, not in the core tool registry.

## Desired Outcome

A `src/modules/read-document/` directory containing:
- `read-document.ts` — migrated tool implementation
- `read-document-extractors.ts` — migrated extractor helpers
- `read-document.test.ts` — co-located tests
- `index.ts` — exports a `KotaModule` registering the tool via `onLoad`

The registration is removed from `src/core/tools/index.ts`. The module loads unconditionally as a built-in.

`src/core/tools/AGENTS.md` and `src/modules/AGENTS.md` are updated to reflect the new ownership.

## Constraints

- Tool name, schema, and behavior must not change.
- No compatibility aliases or dual-registration paths.
- Follow `src/modules/web-access/` as the reference layout.

## Done When

- `src/modules/read-document/` exists with migrated implementation, helpers, tests, and module index.
- `src/core/tools/index.ts` no longer imports or registers the read-document tool.
- `npm test` passes.
- `src/core/tools/AGENTS.md` and `src/modules/AGENTS.md` reflect updated ownership.
