# Scheduler Extension

This directory owns the `scheduler` built-in extension — timed reminders, recurring tasks, and event-triggered automations.

- Registers the `schedule` tool in the `management` tool group.
- Actual schedule tool implementation lives in `src/tools/schedule.ts`.

## Files

- `index.ts` — `KotaExtension` definition; registers the `schedule` tool and scheduler skill.
