---
id: task-split-daemon-ts
title: Split src/scheduler/daemon.ts — extract startup/shutdown helpers
status: done
priority: p2
area: structure
summary: src/scheduler/daemon.ts is 311 lines, over the 300-line limit. Splitting improves navigability and keeps each file focused.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/scheduler/daemon.ts` is 311 lines (4% over the 300-line limit). The file mixes daemon lifecycle management with lower-level helpers.

## Desired Outcome

`daemon.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `daemon.ts`.
- All tests must pass after the split.

## Done When

- `scheduler/daemon.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
