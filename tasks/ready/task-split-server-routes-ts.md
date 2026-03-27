---
id: task-split-server-routes-ts
title: Split server/server-routes.ts (377 lines) into focused route modules
status: ready
priority: p2
area: server
summary: server-routes.ts has grown to 377 lines handling session, history, status, and daemon-state routes alongside a mix of server utility functions. The workflow, approval, and task routes are already extracted; the remaining handlers in server-routes.ts should be split into logical route files (e.g. session-routes.ts, history-routes.ts) following the same pattern.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/server/server-routes.ts` is 377 lines. Workflow, approval, and task routes have already
been extracted to their own files, but session management, history, daemon state, and SSE
handlers remain in the main routes file.

## Desired Outcome

Route handlers are split into focused files (session-routes.ts, history-routes.ts, or similar)
matching the existing pattern of approval-routes.ts, workflow-routes.ts, and task-routes.ts.
server-routes.ts becomes a thin orchestrator that registers the extracted handlers.

## Constraints

- Follow the existing route-file pattern (approval-routes.ts, workflow-routes.ts, task-routes.ts)
- Do not change route paths, middleware, or handler logic during the split

## Done When

- No file in the affected area exceeds 300 lines.
- All existing tests pass.
- Type checking and lint pass.
