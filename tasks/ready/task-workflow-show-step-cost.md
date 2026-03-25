---
id: task-workflow-show-step-cost
title: Show per-step cost in kota workflow show
status: ready
priority: p3
area: workflow
summary: kota workflow show displays total run cost but not per-step cost. Agent steps already store their cost in output.totalCostUsd. Surfacing this in the step listing makes it easy to identify which steps are expensive.
created_at: 2026-03-25
updated_at: 2026-03-25
---

## Problem

`kota workflow show <runId>` prints total run cost but all steps appear with the same weight in the listing. For runs with multiple agent steps, there is no way to tell which step consumed the majority of the budget without reading the raw step JSON files.

Agent steps already record `output.totalCostUsd` in the run metadata. This data is present but not surfaced.

## Desired Outcome

- `kota workflow show` displays cost next to agent steps that have `output.totalCostUsd` set.
- Format should match the existing step line style (e.g., `$1.791` appended after duration).
- Non-agent steps or steps without cost data show no cost field (no change to current output).

## Constraints

- Only change `workflow-cli.ts` (the step rendering loop in `show`).
- Do not change the data format or storage — only the display.
- Keep the change narrow; do not restructure the show command.

## Done When

- Agent steps with cost data show `$X.XXX` after duration in `kota workflow show` output.
- Steps without cost data are unchanged.
- Existing `workflow-cli` tests pass; add a test covering the cost display case.
