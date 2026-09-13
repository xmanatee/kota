---
status: done
---

# Consolidate reminder transition verification at the scheduler owner

## Evidence And Bounded Scope

At published `eb41e8e7c8b0509e8e33cc074f6baa0e950ba4eb`,
`src/core/daemon/scheduler.test.ts` has 619 test LOC and
`scheduler-store.test.ts` has 106. The completed daemon simplification changed
control/chat suites, not these reminder suites. No active task owns this slice.

The in-memory scheduler suite independently repeats repeat creation, repeat-label
preservation and advancement in “markFired reschedules repeating items”, “adds an
item with repeat configuration”, “repeat configuration persists through markFired”
and “repeating items with past trigger advance”. These exercise the same
`Scheduler.add` / `markFired` owner. Cancellation and completed-history cases
also overlap the real SQLite store journey; persistence adds a distinct failure
and must not be assumed redundant.

Own Scheduler transition tests and their direct support only. Consult
`scheduler.ts`, `scheduler-store.ts`, `schedule-parser.ts` and the daemon reminder
consumer. Do not reopen daemon control, scope hosting, workflow scheduling,
Telegram, or the general workflow kernel.

## Outcome And Acceptance

Consolidate demonstrated repeated transition/setup observations into readable
consumer cases. Preserve one-shot versus repeating time/event behavior, minimum
interval and malformed-state handling, future advancement, cancellation and
idempotency, timer replacement, event filtering and unsubscribe, nonrecursive
schedule.fire handling, and scope-scoped durable restart/interleaved writes.
Keep real timer/bus/persistence proof where it detects an additional failure.
Production behavior is not to be removed or changed to achieve a line target.

Use the family-level admission questions: consumer, production owner, stimulus,
observable outcome, distinct failure and cadence. Explain representative removed
and retained cases without a per-assertion registry. A demonstrated no-change
decision is valid; stop at this owner even if the reduction is small. Run the
scheduler/parser/store checks and any directly affected reminder consumer proof.
Do not create a universal scenario interpreter or move tests into support.

## Aggregate Contract

Follow the frozen measurement and shared rules in
`task-assess-fifty-percent-reduction-after-citation-and-reminder-followups`.
Report local executable/support/exclusion/production deltas separately. This
725-line surface is a concrete new opportunity, not a claim that it can close
the aggregate 98,687-line deficit. Preserve the 50% minimum in the successor
assessment; do not substitute completed-task counts for published measurement.

## Completion

Consolidated the Scheduler transition cases and retained real timer, bus and
SQLite proofs. Replaced the vacuous cloned-state corruption check with persisted
malformed input; completed-history proof now checks exact retention after reopen.
No production behavior or support files changed.

Local executable counts: 725 -> 337 (-388); support, exclusions and production
deltas are all zero. The aggregate 50% minimum remains with the successor
assessment; this local result does not establish aggregate completion.

Scheduler/parser/store: 52 tests passed. Scope-host reminder consumer: 4 tests
passed. `pnpm check:fast` passed. The daemon reminder HTTP/SSE integration check
was attempted but could not bind 127.0.0.1 (`listen EPERM`) in this sandbox.
Run `2026-09-13T00-24-37-120Z-builder-27jwnc` retains the admission rationale,
validation details and attributable local measurement in its ordinary summary.
