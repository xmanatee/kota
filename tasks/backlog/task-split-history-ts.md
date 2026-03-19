---
id: task-split-history-ts
title: Split src/memory/history.ts — over 300-line limit
status: backlog
priority: p2
area: structure
summary: history.ts is 322 lines (7% over limit). Extract compaction or storage helpers into a co-located module.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/memory/history.ts` is 322 lines, exceeding the 300-line file size limit.
The file bundles conversation storage, retrieval, and compaction logic in one place.

## Desired Outcome

The file is split into focused modules that each stay under the limit.
Compaction logic or storage helpers should live in a co-located sibling.

## Constraints

- No re-export facades or compatibility shims.
- All imports in consumers must point to the correct new module.
- Tests must still pass.

## Done When

- `src/memory/history.ts` is under 300 lines.
- All extracted code lives in a clearly named sibling module.
- `npm run typecheck`, `npm run lint`, and `npm test` pass.
