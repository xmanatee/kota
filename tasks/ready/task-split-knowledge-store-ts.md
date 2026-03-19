---
id: task-split-knowledge-store-ts
title: Split memory/knowledge-store.ts — extract query or indexing helpers
status: ready
priority: p2
area: structure
summary: src/memory/knowledge-store.ts is 415 lines, 38% over the 300-line limit. The file mixes persistence, querying, and indexing concerns.
created_at: 2026-03-19
updated_at: 2026-03-19T08:38
---

## Problem

`src/memory/knowledge-store.ts` is 415 lines (38% over the 300-line limit). It combines knowledge persistence, query/retrieval logic, and index management in a single file.

## Desired Outcome

`knowledge-store.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `knowledge-store.ts`.
- All tests must pass after the split.

## Done When

- `memory/knowledge-store.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
