---
id: task-split-read-document-ts
title: Split src/core/tools/read-document.ts — 347 lines, over limit
status: done
priority: p3
area: source
summary: Split read-document.ts (347 lines) into focused modules, each under 300 lines.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/core/tools/read-document.ts` is 347 lines, exceeding the 300-line limit in AGENTS.md.

## Desired Outcome

The file is split into two or more co-located modules, each under 300 lines.

## Constraints

- No behavior change — all tests must pass.
- Follow the established split pattern (co-located helper module).

## Done When

- `read-document.ts` is under 300 lines.
- Extracted logic lives in a co-located helper file.
- All tests pass.
