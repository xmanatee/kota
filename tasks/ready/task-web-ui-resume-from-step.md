---
id: task-web-ui-resume-from-step
title: Add resume-from-step action to web UI run detail panel
status: ready
priority: p3
area: web-ui
summary: The CLI has `kota workflow resume-run <id> --from-step <step-id>` but the web UI run detail panel only shows a Retry button (full re-run). Adding a resume-from-step action in the UI lets operators recover failed runs without a terminal.
created_at: 2026-04-08T18:38:00Z
updated_at: 2026-04-08T19:09:14Z
---

## Problem

`kota workflow resume-run` was added to let operators re-execute a failed workflow
from a specific step without repeating earlier steps. It works via the daemon trigger
API by injecting `resumedFromRunId` and `resumeFromStep` into the run payload.

The web UI run detail panel currently shows only a "Retry" button, which re-runs
the entire workflow from scratch. There is no way to do a partial resume from the UI.
Operators managing failed runs from the dashboard must drop to the CLI to use
resume-from-step, which defeats the purpose of the operator-facing web UI.

## Desired Outcome

In the run detail step list, each failed step row shows a "Resume from here" action
button alongside the existing per-step status indicator. Clicking it sends:

```
POST /api/workflow/trigger
{ "name": "<workflow>", "payload": { "resumedFromRunId": "<run-id>", "resumeFromStep": "<step-id>", "resumeTriggeredAt": "<iso>" } }
```

The button is only shown for failed runs (not active or successful runs). A confirmation
dialog is not required; the button state changes to "Queued" on success.

The existing trigger endpoint already accepts `payload` forwarding so no new server
routes are needed.

## Constraints

- Only show the "Resume from here" button when the run is in a terminal failed/interrupted state.
- The button must not appear on steps that did not complete successfully in the source run (these cannot serve as resume points for subsequent steps).
- No new server endpoints; use `POST /api/workflow/trigger` with the resume payload.
- Keep the UI change narrow: one button per failed step in the run detail panel.

## Done When

- Failed run detail panels show a "Resume from here" button on each step.
- Clicking the button queues the workflow via `POST /api/workflow/trigger` with the resume payload.
- The button is absent on successful runs and on steps that did not succeed.
- The button shows a "Queued" or error state after the API call settles.
