---
status: done
---

# Split file-changes.ts — extract simpleDiff into file-diff.ts

## Problem

`file-changes.ts` is 272 lines. The file mixes two distinct concerns: the `ChangeTracker` class (change recording, undo, summary) and the `simpleDiff` utility function (~64 lines, lines 209–272). `simpleDiff` has no dependency on `ChangeTracker` and is a standalone diff formatter that can stand alone.

## Desired Outcome

Extract `simpleDiff` into `src/file-diff.ts`:
- Move the `simpleDiff` function entirely to the new file and export it.

`file-changes.ts` imports `simpleDiff` from `file-diff.ts` and retains only the `ChangeTracker` class, singleton utilities (`initChangeTracker`, `getChangeTracker`, `resetChangeTracker`, `trackFileChange`), and the `TrackedFile` type.

## Constraints

- No behavior changes — structural split only.
- All existing imports from `file-changes.ts` remain unchanged.
- `simpleDiff` is not currently exported; no external callers to update.

## Done When

- `file-diff.ts` exists and exports `simpleDiff`.
- `file-changes.ts` is measurably shorter (under 220 lines).
- `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
