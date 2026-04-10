---
id: task-workflow-step-cost-inspect
title: Show per-step cost breakdown in kota workflow show output
status: done
priority: p3
area: operator
summary: WorkflowStepResult already records costUsd per step, but kota workflow show only displays the run total. Surfacing per-step cost in the inspect output lets operators see which steps drive expense and target prompt or model tuning.
created_at: 2026-04-10T09:20:00Z
updated_at: 2026-04-10T14:00:00Z
---

## Problem

`kota workflow show <run-id>` lists step names, durations, and statuses but omits per-step cost even though `WorkflowStepResult.costUsd` has been populated since `task-workflow-step-cost-tracking` was completed. Operators who want to understand cost distribution across a multi-step run must read raw run artifact JSON files.

## Desired Outcome

- `kota workflow show <run-id>` includes a `$0.0000` cost column alongside each step row (or appended after the step status line).
- Steps with no cost (code steps, emit steps) show `—` or `$0.0000`.
- The existing total cost line at the bottom remains unchanged.
- An optional `--cost` flag is not required; the column is always visible when data is present (cost data is already compact).

## Constraints

- No schema or data model changes; `costUsd` is already in `WorkflowStepResult`.
- Display change is confined to the `show` command output formatter in the workflow module.
- Format must remain readable in an 80-column terminal.

## Done When

- `kota workflow show <run-id>` lists step cost alongside each step.
- Steps with zero cost display clearly distinguished from untracked cost.
- The total cost line at the bottom of the output is unchanged.
