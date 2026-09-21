---
status: done
---
# Preserve which calendar occurrence was cancelled or moved

## Problem and evidence

Google's [event resource reference](https://developers.google.com/workspace/calendar/api/v3/reference/events)
and [recurring-event guide](https://developers.google.com/workspace/calendar/api/guides/recurringevents),
read online September 21, 2026, distinguish an instance's original scheduled
time from its current start. A cancelled recurring exception may lack ordinary
event details; its guaranteed identifying fields include `id`, `recurringEventId`
and `originalStartTime`. The original time can be a date for an all-day instance.

KOTA's Google inbound request decoder and signal normalizer discard
`originalStartTime`. The resulting workflow input retains the opaque instance
and series IDs but loses the supplied occurrence time. For a sparse cancellation,
both normalized start and end are null; for a moved occurrence, only the new
start survives. A workflow reviewing the change cannot recover the original
scheduled time from that signal alone. No missed meeting or live-user failure
has been observed.

Explorer run `2026-09-21T07-46-30-456Z-explorer-o9ave2` retains
`agent/calendar-instance-probe.mjs` and `agent/calendar-instance-probe.json`.
The probe executes the production decoder and normalizer with synthetic timed
cancellation, all-day cancellation, moved-instance and single-event deletion
inputs. All are accepted; the original time is absent from every resulting
signal, including the three inputs that supplied it. The transcript records
inputs, normalized results and the inspected source hash. It uses no network,
credentials, model or daemon.

## Outcome and acceptance

Configured calendar-change workflows receive enough supplied source information
to distinguish the original occurrence from its rescheduled time, including
sparse cancellations, without guessing dates from provider IDs.

- Preserve and validate the supplied original occurrence time through the
  supported Google inbound request path into the emitted signal's typed
  provider data. Preserve all-day dates and timed values with their supplied
  timezone information, separately from current start/end.
- Keep ordinary single-event deletions valid when recurrence metadata is absent.
  Do not invent missing times or trust an unidentified organizer merely because
  a cancellation lacks other fields. Malformed supplied values must fail at
  the existing boundary rather than disappear silently.
- Exercise representative changes through the configured inbound route and
  retain the emitted payload transcript, showing both original and current
  times where applicable. Use the owning verification layer and synthetic
  provider input; live Google access or a model evaluation is not required to
  establish this deterministic information-preservation outcome.

Keep ownership in the Google Workspace adapter and existing inbound-signal
contract. This does not introduce a calendar sync store, recurrence engine,
new automation policy, or automatic meeting mutation.

Overlap checked: the archived inbound-adapter/routing tasks own normalization
and routing generally; calendar completeness owns list pagination, and creation
recovery owns uncertain writes. No active task owns this occurrence metadata
loss. Existing external-pattern decisions remain unchanged.

## Completion

The Google Workspace inbound decoder now validates optional original occurrence
metadata as an all-day date or timed value and preserves its supplied timezone.
The calendar signal carries it separately from current start/end. Ordinary
deletions remain valid without recurrence metadata; unidentified organizers
remain untrusted. Invalid supplied occurrence data returns HTTP 400 without an
emitted signal. Ownership remains in the adapter and existing signal contract.

Verification in builder run `2026-09-21T08-16-13-015Z-builder-wxrac9`:

- `pnpm test:owner src/modules/google-workspace/index.test.ts src/modules/google-workspace/inbound-signal.test.ts`:
  44 tests passed. Configured-route cases cover both request shapes, moved timed
  and all-day instances, sparse cancellations, ordinary deletions, local times
  with named zones, and malformed dates/times/zones rejected before emission.
- `pnpm check:fast` passed production/test typechecking, lint, task validation,
  client-binding checks and module admission.
- Run artifacts `calendar-occurrence-probe.mjs` and
  `calendar-occurrence-transcript.json` retain the configured POST handler's
  inputs, responses, emitted payloads and production source hashes. Four valid
  cases emitted original/current times and trust as expected; an invalid date
  returned 400 with no emission. This executes production decoding and the event
  bus using in-memory HTTP streams; live Google, a daemon, and model evaluation
  were not used or needed for this deterministic adapter outcome.
