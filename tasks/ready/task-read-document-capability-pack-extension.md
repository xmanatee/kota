---
id: task-read-document-capability-pack-extension
title: Move read-document tool into a built-in extension capability pack
status: ready
priority: p2
area: architecture
summary: The read-document tool (PDF, DOCX, EPUB, and other format extraction) lives in src/tools/read-document.ts with a co-located extractors file. Migrating to src/extensions/read-document/ continues the minimal-core migration after the notebook capability pack.
created_at: 2026-04-08T13:25:00Z
updated_at: 2026-04-08T13:25:00Z
---

## Problem

`src/tools/read-document.ts` and `src/tools/read-document-extractors.ts` implement document content extraction (PDF, DOCX, EPUB, HTML). These files are self-contained — no core-protocol dependency — and belong in an extension capability pack, not in the core tool registry.

## Desired Outcome

A `src/extensions/read-document/` directory containing:
- `read-document.ts` — migrated tool implementation
- `read-document-extractors.ts` — migrated extractor helpers
- `read-document.test.ts` — co-located tests
- `index.ts` — exports a `KotaExtension` registering the tool via `onLoad`

The registration is removed from `src/tools/index.ts`. The extension loads unconditionally as a built-in.

`src/tools/AGENTS.md` and `src/extensions/AGENTS.md` are updated to reflect the new ownership.

## Constraints

- Tool name, schema, and behavior must not change.
- No compatibility aliases or dual-registration paths.
- Follow `src/extensions/web-access/` as the reference layout.

## Done When

- `src/extensions/read-document/` exists with migrated implementation, helpers, tests, and extension index.
- `src/tools/index.ts` no longer imports or registers the read-document tool.
- `npm test` passes.
- `src/tools/AGENTS.md` and `src/extensions/AGENTS.md` reflect updated ownership.
