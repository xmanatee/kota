---
id: task-finalize-src-root-entrypoint-allowlist
title: Finalize the src root entrypoint allowlist
status: done
priority: p2
area: architecture
summary: After helper clusters move out of src root, the remaining root files should be explicitly justified as entrypoints or moved to clearer owners.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T09:33:08Z
---

## Problem

Several root `src/*.ts` files may be legitimate thin entrypoints or glue, such
as `cli.ts`, `module-api.ts`, `validate-queue.ts`, and possibly `init.ts`.
Others, such as `cli-history.ts`, `cli-history-commands.ts`,
`project-detection.ts`, `workspace.ts`, and `delegate-prompts.ts`, need an
explicit ownership decision after the helper-move tasks complete.

Without a final allowlist, agents can keep treating root `src/` as an acceptable
general-purpose bucket.

## Desired Outcome

The root source directory has a short, intentional production-file allowlist.
Anything not on that list is moved to `src/core/` or `src/modules/` with a clear
owner.

## Constraints

- Do this after the focused helper-move tasks have reduced the obvious root
  clutter.
- Do not add compatibility re-export files.
- Do not move files just to satisfy aesthetics; keep true package entrypoints at
  root if that is the cleanest public surface.
- Keep the allowlist documented close to the validation or local source-tree
  guidance.

## Done When

- Every remaining production `src/*.ts` file is either an intentional root
  entrypoint or has been moved.
- `src/AGENTS.md` and validation agree on the allowlist.
- New non-allowlisted root production files are caught by the root-helper drift
  validation.
