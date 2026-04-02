---
id: task-web-ui-run-detail-abort
title: Add per-run abort button to the web UI run detail panel
status: ready
priority: p3
area: operator-ux
summary: The API endpoint POST /workflow/runs/:id/abort exists (added in task-abort-single-active-run) and the CLI has kota workflow run abort, but the web UI run detail panel has no abort button for active runs. Operators viewing a specific run must switch to the terminal to abort it.
created_at: 2026-04-02T00:22:00Z
updated_at: 2026-04-02T00:34:41Z
---

## Problem

`POST /workflow/runs/:id/abort` was implemented to abort a single active run by ID, with
CLI access via `kota workflow run abort <run-id>`. The web UI (`src/web-ui/client-run-detail.ts`)
does not expose this. The only web UI abort control is the global "Abort" button in the
workflow controls panel, which stops every active run at once.

An operator viewing the run detail panel for a specific misbehaving run must leave the web UI
and run a CLI command to abort it, which is friction in a browser-first workflow.

## Desired Outcome

The web UI run detail panel shows an "Abort" button when the run is currently active
(status `"running"` or `"repairing"`). Clicking it calls
`POST /api/workflow/runs/:id/abort` and refreshes the panel to show the updated status.
The button is absent for completed, failed, or queued runs (queued runs already have a
separate "Cancel" button in the run list).

## Constraints

- Use the existing `POST /api/workflow/runs/:id/abort` endpoint; no new server routes needed.
- Show a confirmation dialog before sending the abort to prevent accidental clicks.
- Follow the same button style pattern as the existing run-cancel button in `client-workflows.ts`.
- Do not add the button to queued runs (those have DELETE /workflow/runs/:id cancel).
- No changes outside `src/web-ui/`.

## Done When

- The run detail panel shows an "Abort" button when the run status is active.
- Clicking the button (with confirmation) calls the abort endpoint and refreshes.
- The button is absent for non-active runs.
- Existing web UI tests pass.
