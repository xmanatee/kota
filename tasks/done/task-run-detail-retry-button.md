---
id: task-run-detail-retry-button
title: Add retry button to the run detail panel in the web UI
status: done
priority: p3
area: operator-ux
summary: The run detail panel has no retry button. When viewing a failed run via a direct link or hash navigation, operators must navigate back to the workflow history list to retry. Adding a retry button to the detail panel closes this gap.
created_at: 2026-04-02T05:47:58Z
updated_at: 2026-04-02T05:47:58Z
---

## Problem

The web UI run detail panel (`client-run-detail.ts`) shows step-by-step progress, cost, and
failure details, but has no way to retry the run from that view. The retry button exists only
in the main workflow history list (`client-workflows.ts`), so operators who navigate to a
failed run via a `#run=<id>` URL or by clicking a run row must close the detail panel and
find the run in the history list to retry it.

This friction is especially noticeable when the operator was notified of a failure and navigated
directly to the run — they can review the failure but not act on it from that screen.

## Desired Outcome

A "↺ Retry" button in the run detail panel header, visible when the run has a terminal status
(`failed` or `interrupted`). Clicking it calls `POST /api/workflow/retry` with the run ID,
disables itself while the request is in flight, and shows a brief confirmation ("Queued!") on
success — matching the behavior of the existing retry button in the history list.

## Constraints

- Only show the retry button for `failed` and `interrupted` run statuses; hide it for
  `running`, `completed`, `completed-with-warnings`, `cancelled`, and `repairing`.
- Reuse the existing `POST /api/workflow/retry` endpoint — no new server routes.
- Button behavior must match the existing retry button in `client-workflows.ts` (same disabled
  state, same success/error feedback pattern).
- No changes outside `client-run-detail.ts` and `web-ui.ts` (if styles are needed).

## Done When

- A retry button appears in the run detail header for `failed` and `interrupted` runs.
- Clicking the button calls the retry endpoint and shows confirmation on success.
- Button is absent for all other run statuses.
- Existing web UI tests pass.
