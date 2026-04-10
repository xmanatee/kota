---
id: task-workflow-logs-command
title: Add kota workflow logs command to show full agent conversation
status: done
priority: p2
area: workflow-cli
summary: The kota workflow inspect command shows step summaries with truncated output. Debugging a failed or misbehaving agent step requires digging into raw files under .kota/runs/. A logs subcommand that prints the full message transcript for a given run and step would make debugging significantly faster.
created_at: 2026-03-20
updated_at: 2026-03-20T02:14:00Z
---

## Problem

When an agent step produces unexpected output or fails, the only debug path is to manually read `.kota/runs/<run-id>/steps/<step-id>.events.jsonl` and parse it. The `kota workflow inspect` command shows a one-line summary per step with output truncated to 120 chars. There is no CLI-level way to see what the agent actually said or did during a run.

## Desired Outcome

`kota workflow logs <run-id> [--step <step-id>]` prints the agent message transcript for the run. Each turn shows role, content preview, and token cost if available. Without `--step`, all agent steps are shown in order; with `--step`, only the named step is shown.

The output is human-readable, not raw JSON. Long content blocks (tool results, long messages) are truncated with a clear indicator.

## Constraints

- Read-only; no mutations to run state.
- Read events from `.kota/runs/<run-id>/steps/<step-id>.events.jsonl` via `WorkflowRunStore` (see `appendAgentMessage` in `src/core/workflow/run-store.ts`).
- Follow the existing CLI output style in `workflow-cli.ts`.

## Done When

- `kota workflow logs <run-id>` renders readable agent conversation for all agent steps.
- `--step` flag filters to one step.
- At least one test covers the output formatting logic.
- `kota workflow --help` lists the new subcommand.
