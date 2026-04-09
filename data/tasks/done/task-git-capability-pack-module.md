---
id: task-git-capability-pack-module
title: Move git tool into a built-in module capability pack
status: done
priority: p2
area: architecture
summary: The git tool (git status, diff, log, add, commit, branch, push with guardrails) lives in src/tools/git.ts as a core-hosted tool. Migrating it to src/modules/git/ continues the minimal-core migration after the execution capability pack.
created_at: 2026-04-08T01:10:44Z
updated_at: 2026-04-08T02:00:00Z
---

## Problem

`src/tools/git.ts` implements a self-contained version control capability (215 lines, 8 operations, force-push guardrail). It currently lives in the core tool registry alongside runtime primitives like `ask_user`, `approve`, and `batch`. Moving it to an module improves scope clarity, co-locates tests with the tool, and reduces the core registry size.

The web-access and filesystem packs established the pattern: a `src/modules/<name>/` directory with an `index.ts` exporting a `KotaModule`, co-located helpers, and co-located tests.

## Desired Outcome

A `src/modules/git/` directory containing:
- `git.ts` — the migrated tool implementation
- `git.test.ts` — co-located tests (move or write coverage for the force-push guardrail, known operations)
- `index.ts` — exports a `KotaModule` that registers the git tool via `onLoad`

The `git` registration is removed from `src/tools/index.ts`. The module loads unconditionally as a built-in.

`src/tools/AGENTS.md` and `src/modules/AGENTS.md` are updated to reflect the new ownership.

## Constraints

- Tool name, schema, and behavior must not change.
- No compatibility aliases or dual-registration paths.
- Follow `src/modules/web-access/` as the reference layout.
- Do not bundle github-related tools or the github module into this migration — git (the VCS client) and GitHub (the forge integration) are separate concerns.

## Done When

- `src/modules/git/` exists with the migrated tool, tests, and module index.
- `src/tools/index.ts` no longer imports or registers the git tool.
- `npm test` passes.
- `src/tools/AGENTS.md` and `src/modules/AGENTS.md` reflect updated ownership.
