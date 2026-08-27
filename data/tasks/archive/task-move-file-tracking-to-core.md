---
status: done
---

# "Move file-tracking infrastructure from src/ root into core"

## Problem

Three file-tracking files sit at the `src/` root:

- `file-tracker.ts` — imported by `core/tools/checkpoint.ts`
- `file-watcher.ts` — imported by `core/workflow/watch-triggers.ts`
- `file-watcher-core.ts` — low-level watcher primitives

These are kernel infrastructure, not module code. They belong under a `core/`
subtree so `src/` root reads as entrypoints plus clear boundaries rather than a
mixed flat bucket.

## Desired Outcome

All three files live under an appropriate `src/core/` directory (e.g.
`src/core/data/` or a new `src/core/file-tracking/`), imports are updated, and
the local `AGENTS.md` reflects the addition.

## Constraints

- No compatibility shims or re-exports.
- Do not refactor the files, just move and re-wire imports.
- Update `AGENTS.md` files that reference old paths.
- Choose the target directory based on the existing core subtree layout — prefer
  an existing directory if it fits.

## Done When

- The three files are in a core subtree with correct imports.
- Build, typecheck, lint, and tests pass.
