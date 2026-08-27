---
status: done
---

# Split scheduler/scheduler.ts — extract scheduling logic from entry

## Problem

`src/core/daemon/scheduler.ts` is 371 lines (24% over the 300-line limit). The file combines scheduler state, event handling, and execution logic in one place.

## Desired Outcome

`scheduler.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `scheduler.ts`.
- All tests must pass after the split.

## Done When

- `scheduler/scheduler.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
