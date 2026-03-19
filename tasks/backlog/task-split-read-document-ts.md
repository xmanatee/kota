---
id: task-split-read-document-ts
title: Split src/tools/read-document.ts — over 300-line limit
status: backlog
priority: p2
area: structure
summary: read-document.ts is 347 lines (16% over limit). Extract format-specific extraction helpers into a co-located module.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/tools/read-document.ts` is 347 lines, exceeding the 300-line file size limit.
The file contains format-specific extraction logic (PDF, DOCX, RTF, ODT) all in one place.

## Desired Outcome

Format-specific extraction helpers move to a co-located sibling module,
bringing the main file under 300 lines.

## Constraints

- No re-export facades or compatibility shims.
- All imports in consumers must point to the correct new module.
- Tests must still pass.

## Done When

- `src/tools/read-document.ts` is under 300 lines.
- Extracted logic lives in a clearly named sibling.
- `npm run typecheck`, `npm run lint`, and `npm test` pass.
