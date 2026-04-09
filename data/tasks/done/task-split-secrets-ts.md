---
id: task-split-secrets-ts
title: Split secrets.ts — extract provider implementations or parsing helpers
status: done
priority: p2
area: structure
summary: src/secrets.ts is 393 lines, 31% over the 300-line limit. The file mixes secret resolution, provider implementations, and parsing logic.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/secrets.ts` is 393 lines (31% over the 300-line limit). It combines secret resolution orchestration, individual provider implementations, and parsing/validation helpers.

## Desired Outcome

`secrets.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper module. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported from `secrets.ts`.
- All tests must pass after the split.

## Done When

- `secrets.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
