# Scheduler Subsystem

Task scheduling, reminder delivery, and daemon orchestration.

## Files

| File | Purpose |
|------|---------|
| `scheduler.ts` | `Scheduler` — manages scheduled items, due-item polling, event integration |
| `schedule-parser.ts` | Parses time expressions, repeat intervals, and cron-like schedules |
| `task-store.ts` | `TaskStore` — persistent task/todo list (file-based) |
| `task-router.ts` | Classifies user prompts into task types for model routing |
| `daemon.ts` | `Daemon` — long-running background process hosting scheduler + workflows |

## Dependencies

- `scheduler.ts` ← `schedule-parser.ts`, `../event-bus.ts`
- `daemon.ts` ← `scheduler.ts`, `task-store.ts`, `../workflow/runtime.ts`
- `task-router.ts`, `task-store.ts` are mostly standalone
