---
id: task-web-ui-run-tag-filter
title: Add tag filter to web UI run history panel
status: ready
priority: p3
area: operator-ux
summary: The run history panel shows tags on run items but has no way to filter by tag, making operator-assigned tags useful only as visual labels rather than a navigation tool.
created_at: 2026-03-31T16:06:00Z
updated_at: 2026-03-31T16:06:00Z
---

## Problem

`POST /api/workflow/trigger` and the daemon API support setting tags on runs
(`tags` field). The web UI history panel renders tags as badges on run items.
However the filter row (workflow, status, date) has no tag control, so operators
cannot filter the run list to a specific tag. The underlying run store already
supports tag-based queries (`listRuns({ tag })`) but the daemon's
`listWorkflowRuns` handler and the web UI filter UI don't expose it.

## Desired Outcome

A tag filter input in the web UI run history filter row. Selecting or typing a
tag narrows the displayed runs to those bearing that tag. The filter should work
alongside the existing workflow-name, status, and date-range filters.

The daemon control API `GET /workflow/runs` should also accept an optional `tag`
query parameter so future clients (CLI, mobile) can filter server-side.

## Constraints

- Follow the existing filter pattern in `client-workflows.ts` — client-side
  filtering against the already-fetched run list is acceptable for a first cut.
- The tag filter UI should be consistent with the other filter controls (select
  or text input populated from tags seen in the current run list).
- No new npm dependencies.
- Existing web UI tests must pass; add at least one test covering the tag filter
  helper logic.

## Done When

- The web UI history panel has a tag filter control that narrows visible runs.
- The filter clears correctly when set back to "all".
- `GET /workflow/runs?tag=<value>` on the daemon control API returns only runs
  with that tag.
- Existing tests pass; new test covers tag filter behavior.
