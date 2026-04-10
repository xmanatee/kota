---
id: task-split-http-request-ts
title: Split src/core/tools/http-request.ts — over 300-line limit
status: done
priority: p2
area: structure
summary: http-request.ts is 333 lines (11% over limit). Extract request building or response parsing helpers into a co-located module.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/core/tools/http-request.ts` is 333 lines, exceeding the 300-line file size limit.
The file mixes tool definition, request building, and response parsing.

## Desired Outcome

A co-located helper module takes on request building or response parsing,
bringing the main file under 300 lines.

## Constraints

- No re-export facades or compatibility shims.
- All imports in consumers must point to the correct new module.
- Tests must still pass.

## Done When

- `src/core/tools/http-request.ts` is under 300 lines.
- Extracted logic lives in a clearly named sibling.
- `npm run typecheck`, `npm run lint`, and `npm test` pass.
