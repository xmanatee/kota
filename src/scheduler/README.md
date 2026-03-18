# Scheduler Subsystem

Task scheduling, execution, and routing for autonomous and user-triggered actions.

## Files

| File | Purpose |
|------|---------|
| `scheduler.ts` | `Scheduler` — manages scheduled items, due-item polling, event integration |
| `schedule-parser.ts` | Parses time expressions, repeat intervals, and cron-like schedules |
| `task-store.ts` | `TaskStore` — persistent task/todo list (file-based) |
| `task-router.ts` | Classifies user prompts into task types for model routing |
| `action-executor.ts` | `ActionExecutor` — runs scheduled actions via agent sessions |
| `daemon.ts` | `Daemon` — long-running background process with idle task queue |

## Dependencies

- `scheduler.ts` ← `schedule-parser.ts`, `../event-bus.ts`
- `action-executor.ts` ← `scheduler.ts`, `../loop.ts`, `../transport.ts`
- `daemon.ts` ← `scheduler.ts`, `task-store.ts`, `action-executor.ts`, `../loop.ts`
- `task-router.ts`, `task-store.ts` are mostly standalone
