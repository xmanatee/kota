---
id: task-web-ui-workflow-retry
title: Add retry failed run control to the web UI workflow history panel
status: done
priority: p3
area: operator-ux
summary: The CLI has kota workflow retry to re-queue a failed or aborted run, but the web UI provides no equivalent control. Operators must switch to the terminal to retry a failed builder or improver run.
created_at: 2026-03-31T02:30:00Z
updated_at: 2026-03-31T02:42:57Z
---

## Problem

`kota workflow retry <run-id>` re-queues a failed or aborted run by triggering the
same workflow with `retryOf` context. The web UI history panel shows failed runs
with status and detail but provides no action button to retry them inline. Operators
watching the dashboard must switch to the terminal to recover a failed run.

The server layer has no `POST /api/workflow/retry` route; the daemon control API
does not expose a dedicated retry endpoint — the CLI implements retry by calling
`POST /workflow/trigger` with a `retry` event payload.

## Desired Outcome

- A `POST /api/workflow/retry` proxy route in `server-routes.ts` that accepts
  `{ runId: string }` and triggers a retry via the daemon workflow queue.
- A `handleWorkflowRetry` handler in `workflow-routes.ts` following the
  pause/resume/abort pattern.
- A "Retry" action button on each failed or aborted run row in the workflow history
  panel (shown only when `status === "failed"` or `status === "aborted"`).
- On success the panel refreshes to show the new run.

## Constraints

- Only failed and aborted runs should show the retry button; completed and active
  runs should not.
- Follow the existing route handler pattern from pause/resume/abort.
- If no daemon is running, return `503 Daemon not running`.
- Re-use the CLI's trigger payload shape (`event: "retry"`, `payload: { retryOf }`)
  when forwarding to the daemon queue.
- No changes to the daemon control API are required; the retry path goes through
  the existing workflow queue trigger mechanism.

## Done When

- `POST /api/workflow/retry` is handled by the server and successfully re-queues
  the run via the daemon.
- The history panel shows a Retry button on failed/aborted rows.
- Clicking Retry queues the new run and updates the panel without full page reload.
- Handler has basic test coverage following the pause/resume/abort test pattern.
