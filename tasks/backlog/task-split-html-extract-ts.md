---
id: task-split-html-extract-ts
title: Split src/data/html-extract.ts — extract parsing helpers
status: backlog
priority: p2
area: structure
summary: src/data/html-extract.ts is 313 lines, over the 300-line limit. Splitting improves navigability and keeps each file focused.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/data/html-extract.ts` is 313 lines (4% over the 300-line limit). The file mixes extraction logic with lower-level HTML parsing helpers.

## Desired Outcome

`html-extract.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `html-extract.ts`.
- All tests must pass after the split.

## Done When

- `data/html-extract.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
