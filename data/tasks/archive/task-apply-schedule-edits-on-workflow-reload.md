---
status: done
---
# Apply changed workflow schedules and payloads after reload

## Outcome

After an operator reloads a workflow definition, future scheduled dispatches
and the displayed next-run time reflect its current trigger. Moving a daily
report from 09:00 to 10:00 must retire the pending 09:00 dispatch without a
daemon restart. A payload-only change must reach the next dispatch even when
the firing time is unchanged. Preserve already admitted work under its existing
runtime contract.

## Evidence

Explorer `2026-09-21T10-36-14-067Z-explorer-ridi7h` exercised production
definition validation and `ScheduleTriggerManager.setup/reconcile` with a
controlled clock and an enqueue observer. Starting September 21 at 08:00 UTC
with `0 9 * * *`, then reconciling at 08:10:

- Changing the expression to `0 10 * * *` leaves next-run at 09:00, delivers
  the old trigger then, and re-arms for 09:00 the following day.
- Changing the timezone to `America/New_York` also leaves 09:00 UTC instead
  of the revised 13:00 UTC occurrence.
- Changing only payload `revision: old` to `revision: new` delivers `old`.
- Unchanged and removed-trigger controls behave as expected.

The run retains `agent/schedule-reload-probe.mjs` and
`agent/schedule-reload-probe.json`, including source hashes and runtime versions
(Node 22.19.0, ICU 77.1, tzdata 2025b). This is an isolated schedule-owner
observation, not a deployed daemon incident or an executed report. Source
tracing connects the public runtime reload method through
`runtime-definitions.ts` to this reconciliation owner; `runtime-context.ts`
passes its callback to the production workflow queue.

## Research provenance

Read online September 21, 2026:

- [Temporal's TypeScript scheduling guide](https://docs.temporal.io/develop/typescript/workflows/schedules)
  exposes updates to existing schedule configuration and action arguments.
- [Temporal's scheduler architecture](https://github.com/temporalio/temporal/blob/main/docs/architecture/schedules.md)
  describes recalculating scheduling work on updates and an explicit cutoff
  for earlier occurrences. This motivates checking effective edits, not adopting
  Temporal's scheduler or catchup policy.

Archived `task-workflow-definition-reload` already promises schedules matching
the reloaded definition set. Archived
`task-preserve-cron-progress-across-dst-transitions` fixes occurrence calculation
and covers unchanged reloads; this finding concerns a changed trigger at the
same position. No active task or inbox entry owns this outcome.

## Acceptance

- Changed cron, timezone, interval and trigger payload semantics take effect
  for future scheduling through the existing reload path. Retired timer
  callbacks cannot keep re-arming an obsolete trigger or definition.
- Unchanged schedules retain useful timing progress; removed/disabled triggers
  stay cancelled and unrelated schedules continue without duplicate delivery.
  Existing admitted runs retain their canonical ownership and execution rules.
- Retain proportionate owner checks and an isolated runtime reload transcript
  showing current definitions, next-run projections and actual enqueue outcomes
  agree for changed timing and payload-only edits. Controlled clocks and inert
  workflow actions suffice; no live model or production daemon control is needed.

Primary owner: `src/core/workflow/schedule-triggers.ts`, with runtime definition
reload and queue admission as maintained consumers. Builders choose the repair;
no second scheduling engine or new operator configuration is requested.

## Completion

The schedule owner now replaces callbacks with current definitions on reload,
retains deadlines for unchanged timing, and recalculates changed cron, timezone,
and interval timing through the existing occurrence rules. Timer identity guards
reject retired callbacks; advancing before admission prevents a synchronous
reload from repeating the occurrence or resurrecting old timing.

Controlled-clock owner checks cover timing and trigger-kind edits, interval
progress, payload/event refresh and removal, cancellation, unrelated delivery,
and synchronous reload. Existing DST/restart, validation, queue restoration,
and runtime lifecycle checks supply adjacent regression coverage. The isolated
public-runtime probe retained in builder run
`2026-09-21T11-08-19-037Z-builder-aur0m0` records current definitions, next-run
projections, and real SQLite queue admissions: 09:00 is retired, 10:00 fires,
the next occurrence uses new payload/resources, and prior admitted work is
unchanged. It uses an inactive coordinator and inert code actions; no production
daemon or model execution is claimed. Full verification results and limitations
are retained in that run's validation summary.
