---
status: done
---

# Split src/core/tools/http-request.ts — over 300-line limit

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
