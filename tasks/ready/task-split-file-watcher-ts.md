---
id: task-split-file-watcher-ts
title: Split file-watcher.ts — extract watch logic from event dispatch
status: ready
priority: p2
area: structure
summary: src/file-watcher.ts is 474 lines, well over the 300-line limit. Splitting improves navigability and keeps each file focused.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/file-watcher.ts` is 474 lines (58% over the 300-line limit). The file handles file system watching, debounce logic, and event dispatch in one place.

## Desired Outcome

`file-watcher.ts` shrinks to ≤300 lines. Extracted logic lives in a co-located helper file. No behavior changes.

## Constraints

- Public API (exports) must remain the same or be re-exported from `file-watcher.ts`.
- All tests must pass after the split.

## Done When

- `file-watcher.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
