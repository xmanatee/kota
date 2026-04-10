---
id: task-move-file-tracking-to-core
title: "Move file-tracking infrastructure from src/ root into core"
status: backlog
priority: p2
area: architecture
summary: "file-tracker.ts, file-watcher.ts, and file-watcher-core.ts are kernel infrastructure used by core/workflow and core/tools but still live as loose src/ root files. Moving them into a core subtree completes their ownership boundary."
created_at: 2026-04-11T06:45:00Z
updated_at: 2026-04-11T06:45:00Z
---

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
