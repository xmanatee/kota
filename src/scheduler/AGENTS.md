# Scheduler

This directory contains schedule parsing, persistence, routing, and daemon-time scheduling behavior.

- Keep scheduling focused on time/event routing.
- Autonomous workflow execution belongs in workflow/runtime layers, not in ad hoc scheduler behavior.

## Key Modules

- `daemon.ts` — `Daemon` class; orchestration, state management, and public API.
- `daemon-control.ts` — `DaemonControlServer` class and `DaemonControlHandle` interface; the loopback HTTP control API embedded in the running daemon.
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
