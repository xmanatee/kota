---
status: open
priority: p2
---
# Reject reminder requests that would silently change the requested schedule

## Problem

At `f67cc3270`, a direct invocation of the production `runSchedule` tool
with the real `Scheduler` confirms `next Friday at 9am` for today (Tuesday,
September 15). The time parser matches the trailing clock and discards the
weekday. It also accepts `not a time 3pm`, `at 13pm`, and normalizes
`2026-02-30T09:00:00Z` into March 2. Separately, `every 0 seconds` is
confirmed and saved as a one-shot reminder because zero bypasses repeat
validation. These successful responses misrepresent the requested intent.

Explorer run `2026-09-15T00-39-20-926Z-explorer-c5nzwg` retains
`agent/reminder-probe.mjs` and `agent/reminder-probe.json`: real parser/tool
and in-memory scheduler calls, without a daemon, model, timers or notifications.
Primary owners are `src/modules/scheduler/schedule.ts`,
`src/core/daemon/schedule-parser.ts`, and `src/core/daemon/scheduler.ts`.

## Outcome

The reminder tool saves and confirms only a completely understood, valid
schedule. Unsupported date qualifiers and malformed times produce an actionable
error before mutation. Invalid recurrence cannot silently become one-shot,
overflow into invalid dates, or fail later during firing.

## Acceptance

- Reject unconsumed text, invalid clock ranges and impossible calendar dates.
  Supporting weekday language is optional; explicit rejection with supported
  examples is sufficient. Preserve valid documented relative, clock, tomorrow
  and ISO inputs.
- Explicit repeat intervals must be finite, representable and meet the existing
  one-second minimum, including zero and fractional/overflow boundaries.
  Preserve valid hourly/daily/interval and event-trigger behavior.
- Exercise rejection through the real tool and scheduler: no success
  confirmation, no new pending item and existing reminders unchanged. Retain
  a consumer transcript plus proportionate parser/scheduler proof for valid
  scheduling and firing. Keep validation with the existing owners.

This is a reminder correctness repair, not a new scheduler, general natural
language parser, timezone feature or workflow-cron change. Archived
`task-test-schedule-parser-ts` and
`task-consolidate-reminder-transition-verification` own completed test work,
not these newly reproduced production defects.
