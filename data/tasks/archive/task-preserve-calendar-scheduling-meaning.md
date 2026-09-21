---
status: done
---
# Preserve scheduling meaning in calendar event results

## Problem and evidence

The calendar listing tool discards information needed to answer questions such
as whether an event blocks time or whether an invitation was accepted. On
September 21, 2026, a production-tool probe returned identical text for six
otherwise matching provider responses: opaque/accepted, transparent/accepted,
declined, unanswered, tentative, and a different attendee `self` value. Every
result declared the window complete and showed only title, times and email.
This establishes information loss at the tool boundary, not a measured wrong
assistant answer or a live scheduling incident.

Google's [event resource reference](https://developers.google.com/workspace/calendar/api/v3/reference/events),
read online September 21, distinguishes time-blocking `transparency`, event
`status`, attendee `responseStatus`, and `self` (the calendar containing this
copy). Its documented default for transparency is opaque. These facts are
separate: another guest declining does not establish the selected calendar's
response, and attendance is not a complete availability calculation.

Run `2026-09-21T08-16-13-647Z-explorer-vmdwgz` retains
`agent/calendar-meaning-probe.mjs` and `agent/calendar-meaning-probe.json`,
including synthetic inputs, requested URLs, returned text and the source hash.
It invokes `makeCalendarListEvents` with controlled HTTP responses and a dummy
token. No Google account, model, daemon or live calendar was used.

## Outcome and acceptance

Users and agents reading calendar results can distinguish supplied scheduling
and attendance states without inferring them from an event title or email list.

- Preserve and clearly present the provider's time-blocking meaning, event
  status, and attendee responses with correct attribution to the selected
  calendar copy. Explicitly declined, tentative and unanswered invitations
  must remain distinguishable from accepted ones.
- Treat absent fields according to their documented semantics; do not invent
  acceptance or self identity. Keep other attendees' responses attributable
  to those attendees. Handle unsupported or malformed states honestly at the
  existing provider boundary.
- Keep complete/partial/unavailable retrieval reporting and existing calendar
  and time-window selection intact. A complete event list must not claim to
  establish everyone's availability, and nonblocking events must remain
  visible to a caller asking for the agenda.
- Exercise the real tool with controlled provider responses that differ only
  in these meanings, including absent metadata and another guest declining.
  Retain the returned tool transcript and proportionate owner verification.

The owner is the existing Google Workspace calendar tool. The completed
[pagination task](task-preserve-calendar-list-completeness.md) owns
retrieval completeness; occurrence identity and uncertain creation also have
completed owners. None preserves these listing semantics. This outcome does
not require a new free/busy service, planner, calendar write or live-account
setup.

## Completion

The Google Workspace listing boundary now decodes and presents event status,
time-blocking settings, and attendee responses independently. Provider defaults
are labeled; missing responses remain unknown. Only `self` attributes an
attendee to the selected calendar copy, including when no email is supplied.
Omitted attendee details are disclosed. Unsupported or malformed metadata uses
the existing unavailable-page result and preserves earlier valid pages.
Nonblocking events remain visible, and retrieval reporting explicitly separates
list completeness from everyone's availability. Calendar and window selection
and pagination are unchanged.

Owner verification: `pnpm test:owner src/modules/google-workspace/calendar.test.ts`
passed all 41 cases, covering meaningful output differences, defaults and
attribution, boundary rejection, and existing pagination/failure behavior.
The real tool plus production HTTP transport was also exercised with a controlled
dispatcher in 16 scenarios. The six originally indistinguishable variants now
return distinct text. Inputs, requested URLs, source hash, and returned transcripts
are retained in builder run `2026-09-21T08-50-03-000Z-builder-9fi56x` under
`artifacts/calendar-meaning-probe.json`, with
its reproducible `calendar-meaning-probe.mjs` alongside it. Inspection confirmed
transparent events remain in the agenda and a guest decline does not become the
selected calendar's response. This is controlled-provider evidence, not a live
account or measured assistant-answer evaluation.

`pnpm check:fast` passed production/test typechecking, lint, task validation,
generated client binding checks, and bundled module admission.
