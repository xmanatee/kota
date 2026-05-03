---
id: task-web-ui-run-comparison
title: Add run comparison view to web UI for spotting regressions between runs
status: ready
priority: p3
area: client
summary: The React web dashboard has no way to compare two runs of the same workflow side-by-side. Add a comparison view using the existing run detail API and the workflow-ops diff behavior so regressions are visible without manual log archaeology.
created_at: 2026-04-02T12:44:00Z
updated_at: 2026-05-03T02:48:12.588Z
---

## Source / Intent

Originally dropped in `1ef82312` because the old embedded web client had
`src/web-ui/client-run-detail-compare.ts`. That evidence became stale after the
2026-04-15 React rewrite (`01c8919d`). The current dashboard under
`clients/web/src/` has run list and run detail surfaces, but no run comparison
UI. The CLI-side behavior still exists in
`src/modules/workflow-ops/runs/run-diff.ts`; the dashboard should expose the
same operator value.

## Problem

When a workflow starts failing or producing different output, operators must open two run detail panels separately and compare them mentally. The run store captures per-step status, duration, cost, and output for every run, but there is no UI surface that diffs two runs. Debugging regressions after a builder commit, a model upgrade, or a config change requires navigating back and forth between individual run details.

## Desired Outcome

A "Compare" action in the run history list lets operators select two runs of the same workflow and view a comparison table showing:
- Step-by-step status diff (pass/fail/skip changes between runs)
- Per-step cost and duration delta
- Overall cost delta and run duration delta
- Whether the run outcome (success/failure) changed

The comparison view is accessible from the run list or run detail without
leaving the React web UI. No persistent state is needed; the comparison is
computed on demand from existing `/api/workflow/runs/:id` data.

## Constraints

- Only compare runs of the same workflow; enforce this in the UI.
- The comparison must use existing `/api/workflow/runs/:id` data — no new backend endpoints required.
- Keep the view read-only; no workflow controls in the comparison pane.
- Step output content diff is optional for v1; focus on status, cost, and duration changes.

## Done When

- Operators can select two runs from the run history list and open a comparison view.
- The comparison table shows step status diff, cost delta, and duration delta.
- A summary line indicates whether the outcome changed (e.g., "failure → success").
- The feature is reachable from the existing workflow run history panel without a page reload.

## Acceptance Evidence

- A Playwright test or React component test covers selecting two same-workflow
  runs and rendering status, duration, and cost deltas.
- A screenshot under `.kota/runs/<run-id>/` or a Playwright trace/HTML report
  shows the comparison view populated with two real or fixture-backed runs.
- Existing workflow run detail/list behavior still works for a single selected
  run.
