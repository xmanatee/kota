---
id: task-workflow-cron-timezone
title: Add timezone support to cron workflow triggers
status: ready
priority: p2
area: runtime
summary: Cron workflow triggers execute in UTC with no timezone option. Operators in non-UTC timezones must manually convert times, and schedules silently shift during daylight saving transitions.
created_at: 2026-04-09T03:10:00Z
updated_at: 2026-04-09T03:50:00Z
---

## Problem

Workflow `cron` triggers use standard cron syntax evaluated in UTC. Operators
who want a workflow to run at 9am in their local timezone must calculate the UTC
offset manually. Schedules also silently shift by an hour during daylight saving
transitions because the offset changes but the cron expression stays fixed.

For example, an operator in US/Pacific who writes `0 9 * * 1-5` gets a workflow
that runs at 9am UTC (1am or 2am local time) — the opposite of what they intended.

## Desired Outcome

A `timezone` field on `cron` workflow triggers:

```ts
{
  trigger: {
    type: "cron",
    cron: "0 9 * * 1-5",
    timezone: "America/Los_Angeles"
  }
}
```

The scheduler evaluates the expression in the specified IANA timezone, so the
workflow fires at 9am local time and adjusts correctly for daylight saving changes.
When `timezone` is absent, behavior is unchanged (UTC as today).

## Constraints

- Use IANA timezone database names (`America/Los_Angeles`, `Europe/London`, etc.).
- Invalid timezone strings are rejected at definition load time with a clear error.
- The `scheduler.dispatchWindow` config (if set) continues to be evaluated in the
  daemon's local timezone — this task does not change that behavior.
- Document the `timezone` field in `docs/WORKFLOWS.md`.

## Done When

- `cron` triggers accept an optional `timezone` field.
- A cron expression with `timezone: "America/New_York"` fires at the correct
  local time, including across a DST boundary.
- An invalid timezone name causes a startup validation error with the trigger name
  and offending value.
- `docs/WORKFLOWS.md` documents the field with an example.
- Unit test covers: UTC default (no field), named timezone firing at correct wall
  clock time, DST-crossing scenario, invalid timezone rejection.
