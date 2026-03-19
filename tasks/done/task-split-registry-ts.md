---
id: task-split-registry-ts
title: Split src/registry.ts — extract manifest I/O and source parsing
status: done
priority: p2
area: structure
summary: src/registry.ts is 313 lines, over the 300-line limit. The file mixes manifest file I/O, source parsing, and tool lifecycle management — clear boundaries to split on.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/registry.ts` is 313 lines (4% over the 300-line limit). It bundles manifest I/O, source URL parsing, and tool install/remove/update/list in one file.

## Desired Outcome

`registry.ts` shrinks to ≤300 lines. Manifest I/O and/or source parsing logic moves to co-located helper modules. No behavior changes.

## Constraints

- Public exports must remain the same or be re-exported so callers are unaffected.
- All tests must pass after the split.

## Done When

- `src/registry.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
