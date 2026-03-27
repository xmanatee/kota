# Scheduler

This directory contains schedule parsing, persistence, routing, and daemon-time scheduling behavior.

- Keep scheduling focused on time/event routing.
- Autonomous workflow execution belongs in workflow/runtime layers, not in ad hoc scheduler behavior.

## Key Modules

- `daemon.ts` — `Daemon` class; orchestration, state management, and public API.
- `daemon-subscriptions.ts` — `subscribeDaemon`; sets up all event/bus/scheduler subscriptions and returns a single `unsubscribe()` function.
- `daemon-state.ts` — `DaemonState` type and assertion helper.
- `scheduler.ts` — `Scheduler` singleton; timer and bus connection logic.
- `task-store.ts` — task persistence and lookup.
- `task-store-types.ts` — `Task`, `TaskPriority`, `TaskStatus`, and `TaskFileData` type declarations.
