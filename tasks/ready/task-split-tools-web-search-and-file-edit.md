---
id: task-split-tools-web-search-and-file-edit
title: Split tools/web-search.ts and tools/file-edit.ts — both at 291 lines
status: ready
priority: p2
area: refactor
summary: tools/web-search.ts and tools/file-edit.ts are both 291 lines, just under the 300-line limit. Each should be split before they grow over. Both have helper/utility logic that can be extracted alongside the main tool runner.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/tools/web-search.ts` and `src/tools/file-edit.ts` are each 291 lines — 9 lines from the limit. As the tools grow, they will cross the threshold. Both files mix the tool schema/runner with internal helper logic.

## Desired Outcome

For each file, extract internal helpers (parsing, validation, formatting) into a co-located `*-helpers.ts` file (e.g. `web-search-helpers.ts`, `file-edit-helpers.ts`). The main tool file retains the schema and runner entry point and ends up under 230 lines.

## Constraints

- Public tool schema and runner signatures must not change.
- All existing tests must continue to pass.
- Handle both files in a single builder run to keep the split count manageable.

## Done When

- `src/tools/web-search-helpers.ts` and `src/tools/file-edit-helpers.ts` exist.
- Both `web-search.ts` and `file-edit.ts` are measurably reduced (under 230 lines preferred).
- All tests pass.
