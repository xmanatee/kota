---
id: task-module-agents-md-coverage
title: Add AGENTS.md to built-in modules missing directory documentation
status: done
priority: p3
area: modules
summary: Ten built-in modules were migrated to per-directory layout in commit 64cd04f but lack AGENTS.md files. Each module directory should document its purpose, what belongs there, and key boundaries so contributors and agents know what lives where.
created_at: 2026-04-08T15:00:00Z
updated_at: 2026-04-08T15:00:00Z
---

## Problem

Commit `64cd04f` migrated seven built-in modules from flat `.ts` files to per-module
subdirectories (`slack`, `telegram`, `webhook`, `working-memory`, `memory`, `knowledge`,
`history`). Combined with earlier migrations that also landed without AGENTS.md files
(`git`, `notebook`, `github`, `github-webhook`, `read-document`), ten module directories
now have no `AGENTS.md`.

Without AGENTS.md, the directory layout is structurally present but informationally empty —
explorer, builder, improver, and human contributors cannot quickly understand what each
module owns, what belongs there, or where its boundaries are.

The four well-documented modules (`execution`, `filesystem`, `web-access`, `skills`)
demonstrate what good coverage looks like. The other ten should reach that baseline.

## Desired Outcome

Each of the following ten module directories has an `AGENTS.md` that explains:
- What capability or integration the module provides
- What files belong in the directory (tools, tests, helpers, config)
- Key boundaries: what this module does NOT own

Modules to cover:
- `src/modules/git/`
- `src/modules/github/`
- `src/modules/github-webhook/`
- `src/modules/history/`
- `src/modules/knowledge/`
- `src/modules/memory/`
- `src/modules/notebook/`
- `src/modules/read-document/`
- `src/modules/slack/`
- `src/modules/telegram/`
- `src/modules/webhook/`
- `src/modules/working-memory/`

## Constraints

- Keep each AGENTS.md concise (10–20 lines). These are orientation docs, not implementation specs.
- Do not invent boundaries that aren't already present in the code. Describe what is there.
- Do not add AGENTS.md to `execution`, `filesystem`, `web-access`, or `skills` — they already have one.
- No code changes required; docs only.

## Done When

- Every module directory listed above contains an `AGENTS.md`.
- Each AGENTS.md describes the module's capability, what files belong there, and key boundaries.
- The `src/modules/AGENTS.md` (if present) still accurately describes the module inventory.
