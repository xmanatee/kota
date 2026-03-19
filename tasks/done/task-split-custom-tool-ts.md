---
id: task-split-custom-tool-ts
title: Split src/tools/custom-tool.ts — 359 lines, over limit
status: done
priority: p3
area: source
summary: Split custom-tool.ts (359 lines) into focused modules, each under 300 lines.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/tools/custom-tool.ts` is 359 lines, exceeding the 300-line limit in AGENTS.md.

## Desired Outcome

The file is split into two or more co-located modules, each under 300 lines.

## Constraints

- No behavior change — all tests must pass.
- Follow the established split pattern (co-located helper module).

## Done When

- `custom-tool.ts` is under 300 lines.
- Extracted logic lives in a co-located helper file.
- All tests pass.
