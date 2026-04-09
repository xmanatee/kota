---
id: task-workflow-definitions-inspect-cli
title: Add kota workflow definitions CLI for operator visibility
status: done
priority: p3
area: cli
summary: Operators have no CLI command to list or inspect loaded workflow definitions. As the workflow set grows beyond the three built-ins, operators need a fast way to see what workflows are loaded, what triggers they respond to, and how they are configured.
created_at: 2026-03-30T00:00:00Z
updated_at: 2026-03-30T01:00:00Z
---

## Problem

`kota workflow status` shows runtime state (active runs, queue, last-run info)
but does not show what workflow definitions are loaded or how they are
configured. `kota workflow trigger <name>` errors with the list of valid names
if you guess wrong, but there is no `kota workflow definitions` command.

As the workflow set grows — with the attention digest, future notification
workflows, and extension-contributed workflows — operators need a direct
way to inspect definitions without reading the source files.

## Desired Outcome

`kota workflow definitions` lists all loaded workflow definitions with their
triggers, enabled state, step count, and key config (cooldown, daily budget,
timeout). An optional `--name <name>` flag shows full detail for a single
definition including step types and IDs.

## Constraints

- Read definitions from `getBuiltinWorkflowDefinitions()` (and contributed
  definitions when available). Do not re-parse source files.
- When the daemon is running, prefer definitions as the daemon knows them
  (post-reload) over the offline static list.
- Output should be human-readable by default; a `--json` flag for scripting.

## Done When

- `kota workflow definitions` lists all loaded definitions with triggers and
  enabled state.
- `kota workflow definitions --name <name>` prints full definition detail.
- `--json` flag outputs structured JSON.
- Command is registered in `workflow-cli.ts` and documented in the
  workflow-cli `AGENTS.md` inventory.
