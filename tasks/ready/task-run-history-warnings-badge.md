---
id: task-run-history-warnings-badge
title: Show distinct badge and filter option for completed-with-warnings runs in web UI history
status: ready
priority: p2
area: operator-ux
summary: Runs that complete with warnings are shown with the orange interrupted badge in the web UI run history list, indistinguishable from truly interrupted runs. A dedicated warning badge and status filter option would help operators spot and triage runs that completed but produced oversized outputs or schema mismatches.
created_at: 2026-04-02T08:20:00Z
updated_at: 2026-04-02T08:20:00Z
---

## Problem

`client-workflows.ts` renders the run history list badge with three classes: `success`,
`failed`, and a catch-all `interrupted` for anything else. A `completed-with-warnings`
run falls into the `interrupted` bucket and shows the same orange lightning bolt as a
genuinely interrupted run. The status filter dropdown also omits `completed-with-warnings`
as a filter option, so operators cannot isolate these runs without reading every entry.

Since the step output size cap (introduced in `run-executor-step.ts`) is now a live source
of `completed-with-warnings` runs, this mislabelling will become more common as operators
hit the default byte cap.

## Desired Outcome

- `completed-with-warnings` runs display a yellow/amber warning badge distinct from
  the orange interrupted badge.
- The run history status filter dropdown includes a "Warnings" option that filters to
  `completed-with-warnings` runs only.
- A `run-badge.warnings` CSS class is added in `styles-runs.ts` with an appropriate color
  (amber/yellow, distinct from interrupted orange).
- The run history rendering in `client-workflows.ts` handles `completed-with-warnings`
  explicitly rather than relying on the catch-all.

## Constraints

- The run detail panel already surfaces warnings (task-run-warnings-display is done).
  This task is only about the run history list and filter.
- Do not change the status values returned by the API; this is a pure presentation change.
- The filter option must work client-side using the existing `applyHistoryFilter` pattern.

## Done When

- `completed-with-warnings` runs display a distinct amber badge in the run history list.
- The status filter dropdown includes "Warnings" and correctly isolates these runs.
- The `run-badge.warnings` CSS class is added with a color visually distinct from
  `interrupted` orange.
- The web UI test in `web-ui.test.ts` verifies the badge class is applied correctly.
