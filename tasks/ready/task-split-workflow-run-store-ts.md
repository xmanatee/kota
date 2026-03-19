---
id: task-split-workflow-run-store-ts
title: Split workflow/run-store.ts — extract query and serialization helpers
status: ready
priority: p2
area: structure
summary: src/workflow/run-store.ts is 457 lines, over the 300-line limit. The file combines run persistence, querying, and serialization concerns.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/workflow/run-store.ts` is 457 lines (52% over the 300-line limit). It bundles run persistence, query helpers, and serialization/deserialization logic in a single file.

## Desired Outcome

`run-store.ts` shrinks to ≤300 lines. A natural split is extracting serialization and/or query helpers into a co-located module. No behavior changes.

## Constraints

- `RunStore` and related types must remain exported from `run-store.ts` or be re-exported through it.
- All tests must pass after the split.

## Done When

- `workflow/run-store.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
