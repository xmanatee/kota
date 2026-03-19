---
id: task-split-tool-adapters-ts
title: Split tool-adapters.ts — extract adapter implementations from registry
status: ready
priority: p2
area: structure
summary: src/tool-adapters.ts is 423 lines, 41% over the 300-line limit. The file bundles adapter registration, conversion logic, and type helpers in one place.
created_at: 2026-03-19
updated_at: 2026-03-19T09:07:43Z
---

## Problem

`src/tool-adapters.ts` is 423 lines (41% over the 300-line limit). It mixes adapter registration, tool conversion/wrapping logic, and supporting helpers.

## Desired Outcome

`tool-adapters.ts` shrinks to ≤300 lines. A natural split extracts conversion helpers or a group of adapters into a co-located module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `tool-adapters.ts`.
- All tests must pass after the split.

## Done When

- `tool-adapters.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
