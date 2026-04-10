---
id: task-split-delegate-ts
title: Split tools/delegate.ts — extract delegation logic from entry
status: done
priority: p2
area: structure
summary: src/core/tools/delegate.ts is 437 lines, 46% over the 300-line limit. Splitting improves navigability and keeps each file focused.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/core/tools/delegate.ts` is 437 lines (46% over the 300-line limit). The file handles delegation tool registration, execution logic, and supporting types in one place.

## Desired Outcome

`delegate.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `delegate.ts`.
- All tests must pass after the split.

## Done When

- `tools/delegate.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
