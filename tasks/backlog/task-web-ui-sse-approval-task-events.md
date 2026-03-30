---
id: task-web-ui-sse-approval-task-events
title: Replace web UI approval/task polling with SSE event listeners
status: backlog
priority: p3
area: web-ui
summary: The web dashboard polls approvals and tasks every 5 seconds. Once the daemon emits approval.changed and task.changed SSE events, the web UI can react instantly via event listeners instead of polling.
created_at: 2026-03-30T18:28:41Z
updated_at: 2026-03-30T18:28:41Z
---

## Problem

`client.ts` drives approval and task refreshes via `setInterval(refreshApprovals, 5000)` and
`setInterval(refreshTasks, 5000)`. These intervals fire constantly regardless of whether anything
changed, causing unnecessary requests and up to a 5-second lag before the UI reflects a new
approval or a task queue change.

The web UI already subscribes to SSE workflow events via `EventSource` in `client-workflows.ts`:
```js
src.addEventListener("workflow.started", onQueueEvent);
src.addEventListener("workflow.completed", onQueueEvent);
```

The same `EventSource` connection is already open. Adding listeners for `approval.changed` and
`task.changed` on that existing stream is a small change, but polling cannot be removed until the
daemon emits those events (task-daemon-sse-approval-task-events must land first).

## Desired Outcome

- `client-approvals.ts` adds an `approval.changed` listener on the existing SSE source that triggers
  `refreshApprovals()`, removing the 5-second interval.
- `client-tasks.ts` adds a `task.changed` listener that triggers `refreshTasks()`, removing the
  5-second interval.
- The UI still does an initial fetch on page load; it reacts to events for subsequent updates.

## Constraints

- Depends on `task-daemon-sse-approval-task-events` landing first (daemon must emit these events).
- The existing EventSource connection is initialized in `client-workflows.ts`; coordinate access
  or promote it to a shared module rather than opening a second connection.
- Do not remove the polling without the SSE events backend in place — keep polling as a fallback
  if EventSource is unavailable or the daemon is running an older version.
- Keep the change minimal: this is wiring, not a UI redesign.

## Done When

- Approvals and tasks update immediately when the daemon emits the corresponding SSE event.
- The 5-second polling intervals for approvals and tasks are removed (or disabled when SSE is live).
- No second EventSource connection is opened.
- Existing web UI tests pass; a basic event-handling test is added if practical.
