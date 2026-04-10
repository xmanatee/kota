---
id: task-split-computer-use-ts
title: Split tools/computer-use.ts — extract action handlers from entry
status: done
priority: p2
area: structure
summary: src/core/tools/computer-use.ts is 419 lines, 40% over the 300-line limit. Splitting improves navigability and keeps each file focused.
created_at: 2026-03-19
updated_at: 2026-03-19T09:13:55
---

## Problem

`src/core/tools/computer-use.ts` is 419 lines (40% over the 300-line limit). The file combines computer-use tool registration, action dispatch, and per-action implementation in one place.

## Desired Outcome

`computer-use.ts` shrinks to ≤300 lines. Action handler implementations move to a co-located helper. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `computer-use.ts`.
- All tests must pass after the split.

## Done When

- `tools/computer-use.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
