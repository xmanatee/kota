---
status: open
priority: p1
---
# Keep scheduled workflows responsive across missing and repeated local hours

## Outcome

An operator's valid timezone-aware cron workflow must not stall schedule setup
or repeatedly schedule an already-past instant at a daylight-saving transition.
Next-occurrence calculation must terminate, advance strictly beyond its input
instant, and preserve the documented wall-clock recurrence semantics.

## Evidence

Explorer `2026-09-21T09-26-00-573Z-explorer-jvqojn` compared external scheduling
contracts with KOTA at `bad4bc98b4af50592e1c87a2bc796bcd931cf170`:

- `30 1 * * *`, `Europe/London`, from `2026-03-29T00:00:00Z` passes cron
  and timezone validation but `getNextCronTime` does not return within the
  isolated child process's three-second deadline. Source inspection shows the
  missing-hour conversion returns to the same candidate instead of advancing.
- `45 1 * * *`, `America/New_York`, from `2026-11-01T06:31:00Z` returns
  `2026-11-01T05:45:00Z`, 46 minutes before its input.
- The real `ScheduleTriggerManager.setup` reproduces the London timeout and
  projects the past New York instant through `nextScheduledAt`. UTC and
  ordinary-day controls return future occurrences normally.

The run's retained `agent/cron-dst-probe.mjs`, `cron-dst-probe.json`,
`cron-consumer-probe.mjs`, and `cron-consumer-probe.json` contain reproducible
inputs, outputs and source hashes. They import production code using Node
22.19.0 / ICU 77.1 / tzdata 2025b. The consumer probe controls the clock and
captures enqueue calls, clearing timers before delivery. No live daemon,
model, notifications or production incident was involved. An immediate-fire
loop is a risk inferred from the timer consumer, not an observed deployment.

## Research provenance

Read online September 21, 2026:

- [n8n scheduler](https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/scheduler/README.md)
  distinguishes elapsed intervals from timezone-based wall-clock recurrence.
- [Temporal schedule contract](https://github.com/temporalio/api/blob/master/temporal/api/schedule/v1/message.proto)
  explicitly skips nonexistent clock times and matches both repeated times.
- [TC39 time-zone guidance](https://github.com/tc39/proposal-temporal/blob/main/docs/timezone.md)
  explains that local-to-exact conversion can be ambiguous and exposes explicit
  disambiguation choices. Conversion policy alone is not a recurrence algorithm.

These sources motivate explicit transition semantics; adopting their engines
or a new scheduling abstraction is not required.

## Acceptance

- Resolve both reproduced failures at the existing cron/schedule owner. Valid
  searches terminate with a future matching occurrence, or the documented
  no-match result when appropriate; a missing hour must not discard a daily
  schedule that has later valid occurrences.
- Make skipped-hour and repeated-hour behavior explicit. Successive results
  advance in absolute time, including within the repeated hour. Preserve UTC
  defaults, ordinary local-time scheduling and existing field semantics.
- Retain proportionate owner proof and a real schedule-manager transcript
  across the transitions, showing responsive setup and re-arming without
  overdue-fire churn or loss of unrelated scheduled work. Controlled clocks
  and isolated execution suffice; live model access is unnecessary.

Primary owners: `src/core/workflow/cron.ts` and `schedule-triggers.ts`.
Archived `task-workflow-cron-timezone` added timezone support but its retained
test checks 09:00 across an offset change, outside missing/repeated hours.
Archived `task-reject-misinterpreted-reminder-schedules` concerns reminder
parsing and explicitly excludes workflow cron. No active task owns this repair.
