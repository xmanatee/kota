# Scheduler Module

This directory owns the `scheduler` repo module — timed reminders, recurring tasks, and event-triggered automations.

- Registers the `schedule` tool in the `management` tool group.

## Files

- `index.ts` — `KotaModule` definition; registers the `schedule` tool and scheduler skill.
- `schedule.ts` — `scheduleTool` schema and `runSchedule` runner.
