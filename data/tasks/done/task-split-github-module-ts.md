---
id: task-split-github-module-ts
title: Split src/modules/github/index.ts into focused files
status: done
priority: p2
area: architecture
summary: The github module index.ts is 742 lines — more than double the 300-line target. PR tools, issue tools, auth helpers, and task-provider wiring should each have their own file, following the pattern already established in web-access, filesystem, and execution.
created_at: 2026-04-10T05:20:00Z
updated_at: 2026-04-10T05:20:00Z
---

## Problem

`src/modules/github/index.ts` has grown to 742 lines across four distinct
concerns: OAuth token resolution and auth helpers, PR-specific tools (list,
create, merge, close, list-commits, add-comment), issue-specific tools (list,
get, create, update, add-label, remove-label), and task-provider wiring via
`GitHubTaskProvider`. This makes the file hard to navigate and violates the
300-line limit documented in AGENTS.md.

`task-provider.ts` is already extracted, but the main index still carries all
tool implementations inline. The execution, filesystem, and web-access modules
show how to structure a module with multiple focused files.

## Desired Outcome

`src/modules/github/` is reorganized into:

- `github-auth.ts` — token resolution, `resolveToken` helper, `githubFetch` wrapper
- `github-pr.ts` — all PR tools and their implementations
- `github-issues.ts` — all issue tools and their implementations
- `index.ts` — module registration only: wires auth config, assembles tools from
  the above files, registers `GitHubTaskProvider` via `onLoad`

Each file stays under the 300-line target. `task-provider.ts` is unchanged.

## Constraints

- No behavior changes — all existing tools keep the same names, schemas, and behavior.
- All tests continue to pass; no new tests are required unless extraction reveals untested paths.
- `AGENTS.md` updated to list the new files and their roles.
- `docs/CONFIG.md` github section is unchanged (no new config keys).

## Done When

- `src/modules/github/index.ts` is under 300 lines and only handles wiring.
- Auth helpers, PR tools, and issue tools each live in their own file.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm test` pass.
- `src/modules/github/AGENTS.md` lists all new files.
