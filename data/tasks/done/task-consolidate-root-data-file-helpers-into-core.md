---
id: task-consolidate-root-data-file-helpers-into-core
title: Move root data and file helper utilities into core
status: done
priority: p2
area: architecture
summary: Shared helpers such as json-file, frontmatter, repo-worktree, log-format, and path-scope still live in src/ root and are imported via #root by core and modules.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T03:50:00Z
---

## Problem

The module-first cleanup moved many large areas into `src/core/` and
`src/modules/`, but several generic helpers still live directly under `src/`.
Files like `json-file.ts`, `frontmatter.ts`, `repo-worktree.ts`, `log-format.ts`,
and `path-scope.ts` are shared infrastructure, not public entrypoints.

Keeping them in root preserves a vague shared bucket and encourages new
`#root/*` imports.

## Desired Outcome

Move this coherent helper cluster into an appropriate core location and update
imports to use `#core/*`.

## Constraints

- Keep the move focused to data/file/path/repo helpers.
- Do not create compatibility re-export files at the old root paths.
- Do not mix in unrelated loop, execution, or adapter helpers.
- Update local `AGENTS.md` files if the destination boundary needs clarification.

## Done When

- The selected helper files no longer exist in `src/` root.
- Production imports no longer reference those helpers through `#root/*`.
- Tests and docs import the new locations directly.
- The root source tree is closer to thin entrypoints only.
