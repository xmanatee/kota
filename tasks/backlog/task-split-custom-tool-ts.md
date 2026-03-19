---
id: task-split-custom-tool-ts
title: Split tools/custom-tool.ts — extract tool execution helpers
status: backlog
priority: p2
area: structure
summary: src/tools/custom-tool.ts is 359 lines, 20% over the 300-line limit. Splitting improves navigability and keeps each file focused.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/tools/custom-tool.ts` is 359 lines (20% over the 300-line limit). The file bundles tool definition, execution logic, and supporting helpers in one place.

## Desired Outcome

`custom-tool.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `custom-tool.ts`.
- All tests must pass after the split.

## Done When

- `tools/custom-tool.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
