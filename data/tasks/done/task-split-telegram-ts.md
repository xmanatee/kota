---
id: task-split-telegram-ts
title: Split telegram.ts — extract message handlers or client helpers
status: done
priority: p2
area: structure
summary: src/telegram.ts is 382 lines, 27% over the 300-line limit. Splitting improves navigability and keeps each file focused.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/telegram.ts` is 382 lines (27% over the 300-line limit). The file bundles Telegram bot setup, message handling, and supporting logic together.

## Desired Outcome

`telegram.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `telegram.ts`.
- All tests must pass after the split.

## Done When

- `telegram.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
