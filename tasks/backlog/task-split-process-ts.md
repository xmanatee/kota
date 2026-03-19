---
id: task-split-process-ts
title: Split src/tools/process.ts — over 300-line limit
status: backlog
priority: p2
area: structure
summary: process.ts is 339 lines (13% over limit). Extract buffer/output logic into a co-located helper.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/tools/process.ts` is 339 lines, exceeding the 300-line file size limit.
It bundles process lifecycle, output buffering, and signal handling in one file.

## Desired Outcome

Output buffering or lifecycle helpers move to a co-located sibling module,
bringing the main file under 300 lines.

## Constraints

- No re-export facades or compatibility shims.
- All imports in consumers must point to the correct new module.
- Tests must still pass.

## Done When

- `src/tools/process.ts` is under 300 lines.
- Extracted logic lives in a clearly named sibling.
- `npm run typecheck`, `npm run lint`, and `npm test` pass.
