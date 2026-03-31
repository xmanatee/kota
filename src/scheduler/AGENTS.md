# Scheduler

This directory contains schedule parsing, persistence, routing, and daemon-time scheduling behavior.

- Keep scheduling focused on time/event routing.
- Autonomous workflow execution belongs in workflow/runtime layers, not in ad hoc scheduler behavior.

## Key Modules

- `daemon.ts` — `Daemon` class; orchestration, state management, and public API.
- `daemon-control.ts` — `DaemonControlServer` class; HTTP server wiring, route dispatch, SSE, and authorization. Re-exports all public types from `daemon-control-types.ts`.
- `daemon-control-types.ts` — all shared types for the control API: `DaemonControlHandle`, `DaemonLiveStatus`, `DaemonSseEvent`, `InteractiveSession`, workflow run/status/definition types, and `CapabilityScope`.
- `daemon-control-utils.ts` — `jsonResponse` helper shared by route modules.
- `daemon-control-approvals.ts` — approval list, approve, and reject endpoint handlers.
- `daemon-control-sessions.ts` — session list, register, and unregister endpoint handlers.
- `daemon-control-workflow.ts` — workflow status, definitions, runs, pause/resume/abort/reload/trigger endpoint handlers.
- `daemon-control-history.ts` — history list, show, and delete endpoint handlers.
- `daemon-control-metrics.ts` — Prometheus metrics endpoint handler.
- `daemon-control-webhook.ts` — inbound webhook trigger endpoint handler.
- `daemon-subscriptions.ts` — `subscribeDaemon`; sets up all event/bus/scheduler subscriptions and returns a single `unsubscribe()` function.
- `daemon-state.ts` — `DaemonState` type and assertion helper.
- `scheduler.ts` — `Scheduler` singleton; timer and bus connection logic.
- `scheduler-store.ts` — file I/O helpers for the Scheduler; reads/writes schedule JSON files, handles cleanup of excess fired and cancelled items.
- `schedule-parser.ts` — pure parsing, formatting, and type definitions for the scheduler; `ScheduledItem`, `parseTime`, `parseRepeat`, `matchesFilter`, `formatRelative`.
- `task-store.ts` — task persistence and lookup.
- `task-store-types.ts` — `Task`, `TaskPriority`, `TaskStatus`, and `TaskFileData` type declarations.
- `task-router.ts` — `routeTask`, `formatTaskHint`; exported `TaskType` and `TaskRoute` types.
- `task-router-data.ts` — `TASK_PATTERNS`, `STRATEGIES`, `GROUP_RECOMMENDATIONS`, and `PatternEntry` type; static data only.
- `session-sweep.ts` — `sweepExpiredSessions`; pure function that removes idle sessions from a `Map` and returns the expired IDs.
