---
status: done
---

# Split server/server.ts — extract route handlers or middleware helpers

## Problem

`src/server/server.ts` is 398 lines (33% over the 300-line limit). It mixes server initialization, route definitions, and request handler logic.

## Desired Outcome

`server.ts` shrinks to ≤300 lines. A natural split extracts route handlers or middleware into a co-located module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `server.ts`.
- All tests must pass after the split.

## Done When

- `server/server.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
