---
status: open
priority: p2
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
[pagination task](archive/task-preserve-calendar-list-completeness.md) owns
retrieval completeness; occurrence identity and uncertain creation also have
completed owners. None preserves these listing semantics. This outcome does
not require a new free/busy service, planner, calendar write or live-account
setup.
