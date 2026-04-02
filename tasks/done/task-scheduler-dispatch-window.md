---
id: task-scheduler-dispatch-window
title: Add configurable dispatch window to restrict autonomous scheduler hours
status: done
priority: p3
area: runtime
summary: The autonomous scheduler dispatches idle and interval triggers around the clock. Operators cannot restrict dispatch to business hours without pausing the entire scheduler manually. A configurable dispatch window would let teams limit when autonomous workflows run without continuous operator intervention.
created_at: 2026-04-01T07:22:00Z
updated_at: 2026-04-02T07:30:00Z
---

## Problem

The daemon scheduler fires `runtime.idle` and interval-triggered workflows continuously
once the daemon starts. There is no built-in way to say "only run builder and explorer
between 09:00 and 18:00 on weekdays." The only control available is `POST /pause`, which
requires an operator to manually resume later.

Teams running KOTA in shared or regulated environments need tighter control over when
autonomous work starts. Letting the builder commit code at 3am, or the explorer modify
the task queue on a holiday, can be surprising and hard to audit after the fact.

## Desired Outcome

A `scheduler.dispatchWindow` config field that accepts a time range and optional days-of-week
mask. When set, the scheduler checks the current local time before dispatching an idle or
interval trigger — if the current time falls outside the window, the trigger is deferred
until the window next opens. Cron triggers and event triggers are not affected.

Example config:

```json
{
  "scheduler": {
    "dispatchWindow": {
      "start": "09:00",
      "end": "18:00",
      "days": ["mon", "tue", "wed", "thu", "fri"]
    }
  }
}
```

When no `dispatchWindow` is set, behavior is identical to today (always dispatch).

## Constraints

- Affects `runtime.idle` (idle trigger) and `intervalMs` (interval trigger) only. Cron,
  event, file-watch, and manual (`kota workflow trigger`) triggers are not affected.
- Window boundaries are checked at dispatch time, not during a running step — already-started
  runs complete normally.
- Use the daemon's local timezone; do not add IANA timezone config in this task.
- Validate the config at startup and emit a clear error for malformed windows.
- Document the config field in `docs/CONFIG.md` or equivalent.

## Done When

- `scheduler.dispatchWindow` is accepted in `kota.config`.
- Idle and interval triggers are deferred when the current time is outside the window.
- In-window and out-of-window behavior is covered by a unit test.
- Config field is documented.
