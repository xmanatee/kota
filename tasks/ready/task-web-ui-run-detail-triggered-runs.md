---
id: task-web-ui-run-detail-triggered-runs
title: Show downstream triggered runs in web UI run detail panel
status: ready
priority: p3
area: operator-ux
summary: The run detail panel shows the parent run ("Triggered by") but not the child runs that this run triggered. The CLI already surfaces downstream runs; the web UI and daemon API support the same filter but the detail panel doesn't use it.
created_at: 2026-04-02T01:51:00Z
updated_at: 2026-04-02T02:37:15Z
---

## Problem

`kota workflow runs show <id>` lists "Triggered runs:" for child runs spawned by a
workflow trigger step. The daemon control API already supports `?causedByRunId=<id>`
on `GET /api/workflow/runs`, and `client-run-detail.ts` shows "Triggered by: <parent>"
for the parent direction — but the reverse (downstream children) is absent from the
web UI run detail panel.

Operators inspecting a workflow run in the web UI cannot see which child runs it
spawned without switching to the CLI.

## Desired Outcome

The web UI run detail panel shows a "Triggered runs" section when the current run has
spawned downstream runs:

- Fetches `GET /api/workflow/runs?causedByRunId=<currentRunId>` when the detail panel
  opens.
- Renders a compact list of child runs with their workflow name, status icon, and
  clickable run ID that opens the run detail panel for the child.
- If no downstream runs exist, the section is omitted.
- Consistent style with the existing "Triggered by" parent link.

## Constraints

- Fetch is a single additional call after the main run fetch — no new endpoint needed.
- Only render the section if the response returns at least one run.
- Do not render the section for workflow types that cannot trigger child runs (any run
  can in principle; omission is the correct display when the result is empty).
- Change confined to `client-run-detail.ts`; no modifications to `web-ui.ts` or CSS
  unless a minor style rule is required.

## Done When

- Opening a run detail panel for a run that triggered child runs shows a "Triggered
  runs" list with clickable entries.
- Clicking a child run entry opens that run's detail panel.
- Runs with no downstream children show no section.
- Existing `web-ui.test.ts` passes; at minimum a snapshot or DOM test covers the
  section rendering path.
