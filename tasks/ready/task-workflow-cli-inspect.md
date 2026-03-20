---
id: task-workflow-cli-inspect
title: Add kota workflow CLI subcommand for run inspection
status: ready
priority: p2
area: cli
summary: Add a `kota workflow` subcommand that lists recent runs, shows status and step results, and displays the current runtime queue — giving operators visibility into the autonomous system from the terminal.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The workflow runtime runs autonomously but there is no CLI surface for inspecting it. To understand what ran, what failed, or what is queued, an operator must manually read `.kota/runs/*/metadata.json` and `.kota/workflow-state.json`. This is fragile and slow.

## Desired Outcome

A `kota workflow` subcommand (or `kota wf` alias) with at minimum:
- `kota workflow list` — list recent runs with workflow name, status, duration, trigger event
- `kota workflow show <run-id>` — show step results, cost, and any error for a specific run
- `kota workflow status` — show active run (if any), queued runs, and per-workflow last-run timestamps

All data is already available in `WorkflowRunStore.readState()`, `WorkflowRunStore.runsDir`, and per-run `metadata.json` files. No new persistence needed.

## Constraints

- Read-only command; no mutations
- Use existing `WorkflowRunStore` and run metadata shape — no new file formats
- Output should be human-readable terminal text; no external dependencies

## Done When

- `kota workflow list` prints recent runs in a useful format
- `kota workflow show <run-id>` shows step-level details
- `kota workflow status` shows current queue and last-run info per workflow
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass
