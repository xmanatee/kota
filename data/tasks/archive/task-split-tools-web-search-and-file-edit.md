---
status: done
---

# Split tools/web-search.ts and tools/file-edit.ts — both at 291 lines

## Problem

`src/core/tools/web-search.ts` and `src/core/tools/file-edit.ts` are each 291 lines — 9 lines from the limit. As the tools grow, they will cross the threshold. Both files mix the tool schema/runner with internal helper logic.

## Desired Outcome

For each file, extract internal helpers (parsing, validation, formatting) into a co-located `*-helpers.ts` file (e.g. `web-search-helpers.ts`, `file-edit-helpers.ts`). The main tool file retains the schema and runner entry point and ends up under 230 lines.

## Constraints

- Public tool schema and runner signatures must not change.
- All existing tests must continue to pass.
- Handle both files in a single builder run to keep the split count manageable.

## Done When

- `src/core/tools/web-search-helpers.ts` and `src/core/tools/file-edit-helpers.ts` exist.
- Both `web-search.ts` and `file-edit.ts` are measurably reduced (under 230 lines preferred).
- All tests pass.
