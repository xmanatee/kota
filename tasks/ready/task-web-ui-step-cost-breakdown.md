---
id: task-web-ui-step-cost-breakdown
title: Show per-step cost in the web UI run detail step list
status: ready
priority: p3
area: operator-ux
summary: The web UI run detail view shows total run cost in the header but does not show per-step cost. Agent steps already record output.totalCostUsd and the CLI surfaces this; the web UI should match.
created_at: 2026-04-01T04:03:40Z
updated_at: 2026-04-01T05:41:53Z
---

## Problem

The run detail panel shows total `costUsd` in the run header but each step row displays only step name and duration. Agent steps record `output.totalCostUsd` in the run metadata — this data is available but not rendered. Operators who want to identify which step consumed the most budget must either use `kota workflow show` in the CLI or inspect raw run JSON files.

## Desired Outcome

Each agent step row in the run detail panel shows its cost next to the duration when `output.totalCostUsd` is present. Non-agent steps or steps without cost data display no cost field. The format should be consistent with the existing step meta style (e.g. `$1.791` appended after duration).

## Constraints

- Change is confined to `src/web-ui/client-run-detail.ts`; no server or API changes required.
- Steps without cost data must remain unchanged in appearance.
- Total cost in the run header stays as-is.
- Keep the rendering narrow; do not restructure the step loop.

## Done When

- Agent steps with `output.totalCostUsd` show `$X.XXX` after their duration in the run detail panel.
- Steps without cost data are visually unchanged.
- Existing web-ui render tests pass; a new test covers the cost display case.
