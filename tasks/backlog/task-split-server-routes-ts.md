---
id: task-split-server-routes-ts
title: Split server/server-routes.ts — extract event and daemon handlers
status: backlog
priority: p2
area: refactor
summary: server/server-routes.ts is 292 lines, 8 from the limit. The readDaemonState helper and handleEventTrigger handler are self-contained and can be extracted into co-located route files, leaving buildRequestHandler as a pure dispatcher.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`src/server/server-routes.ts` is 292 lines — 8 lines from the 300-line limit. It mixes top-level helper functions (`readDaemonState`, `handleEventTrigger`) with the main `buildRequestHandler` dispatcher. As routes are added, it will cross the limit.

## Desired Outcome

Extract `readDaemonState` into `src/server/daemon-routes.ts` and `handleEventTrigger` into `src/server/event-routes.ts`. Import both back into `server-routes.ts`. The main file becomes a pure dispatcher and drops to ~240 lines.

## Constraints

- Public exports (`ServerContext`, `buildRequestHandler`, `readDaemonState`) must remain importable from `server-routes.ts` (re-export if needed).
- All existing tests must continue to pass.

## Done When

- `src/server/daemon-routes.ts` exports `readDaemonState`.
- `src/server/event-routes.ts` exports `handleEventTrigger`.
- `server-routes.ts` is measurably reduced (under 250 lines).
- All tests pass.
