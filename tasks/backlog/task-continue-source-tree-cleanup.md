---
id: task-continue-source-tree-cleanup
title: Continue source tree cleanup
status: backlog
priority: p1
area: structure
summary: Reduce oversized directories and tighten file boundaries so the source tree stays legible.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

Several parts of the source tree still carry too many unrelated files or weak
boundaries, which makes future changes harder to reason about.

## Desired Outcome

The repo should have clearer, smaller, and more intention-revealing directories.

## Constraints

- Favor real boundary improvements over cosmetic moves.
- Avoid adding re-export facades or compatibility layers.
- Keep imports and ownership easy to follow.

## Done When

- A meaningful boundary problem is removed.
- The resulting structure is simpler to navigate.
- Validation covers the moved or refactored behavior.
