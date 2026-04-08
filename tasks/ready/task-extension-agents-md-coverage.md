---
id: task-extension-agents-md-coverage
title: Add AGENTS.md to built-in extensions missing directory documentation
status: ready
priority: p3
area: extensions
summary: Ten built-in extensions were migrated to per-directory layout in commit 64cd04f but lack AGENTS.md files. Each extension directory should document its purpose, what belongs there, and key boundaries so contributors and agents know what lives where.
created_at: 2026-04-08T15:00:00Z
updated_at: 2026-04-08T15:00:00Z
---

## Problem

Commit `64cd04f` migrated seven built-in extensions from flat `.ts` files to per-extension
subdirectories (`slack`, `telegram`, `webhook`, `working-memory`, `memory`, `knowledge`,
`history`). Combined with earlier migrations that also landed without AGENTS.md files
(`git`, `notebook`, `github`, `github-webhook`, `read-document`), ten extension directories
now have no `AGENTS.md`.

Without AGENTS.md, the directory layout is structurally present but informationally empty —
explorer, builder, improver, and human contributors cannot quickly understand what each
extension owns, what belongs there, or where its boundaries are.

The four well-documented extensions (`execution`, `filesystem`, `web-access`, `skills`)
demonstrate what good coverage looks like. The other ten should reach that baseline.

## Desired Outcome

Each of the following ten extension directories has an `AGENTS.md` that explains:
- What capability or integration the extension provides
- What files belong in the directory (tools, tests, helpers, config)
- Key boundaries: what this extension does NOT own

Extensions to cover:
- `src/extensions/git/`
- `src/extensions/github/`
- `src/extensions/github-webhook/`
- `src/extensions/history/`
- `src/extensions/knowledge/`
- `src/extensions/memory/`
- `src/extensions/notebook/`
- `src/extensions/read-document/`
- `src/extensions/slack/`
- `src/extensions/telegram/`
- `src/extensions/webhook/`
- `src/extensions/working-memory/`

## Constraints

- Keep each AGENTS.md concise (10–20 lines). These are orientation docs, not implementation specs.
- Do not invent boundaries that aren't already present in the code. Describe what is there.
- Do not add AGENTS.md to `execution`, `filesystem`, `web-access`, or `skills` — they already have one.
- No code changes required; docs only.

## Done When

- Every extension directory listed above contains an `AGENTS.md`.
- Each AGENTS.md describes the extension's capability, what files belong there, and key boundaries.
- The `src/extensions/AGENTS.md` (if present) still accurately describes the extension inventory.
