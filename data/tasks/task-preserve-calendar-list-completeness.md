---
status: open
priority: p2
---
# Report calendar results honestly when Google returns multiple pages

## Problem and evidence

At repository revision `002144bc31ad6b6a571c6c9f3bac12c1510d863a`,
`calendar_list_events` returns `No upcoming events found.` for a successful
response containing `items: []` and a nonempty `nextPageToken`. It makes no
continuation request. A nonempty intermediate page also loses its continuation
information, leaving the caller unable to distinguish a partial list from an
exhausted query. This can mislead an assistant answering a schedule question;
no actual missed meeting or live-account failure was observed.

Google's [Events.list reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
read online September 21, 2026, explicitly permits short or empty nonterminal
pages and identifies `nextPageToken` as the continuation signal.

Explorer run `2026-09-21T05-26-43-569Z-explorer-rwndqn` retains
`agent/calendar-pagination-probe.mjs` and `agent/calendar-pagination-probe.json`.
The probe calls the production tool with synthetic HTTP responses and a dummy
token, recording requests, returned text and the source hash. Empty terminal,
empty nonterminal and nonempty nonterminal responses were exercised. No live
Google API, model, daemon or credentials were used.

## Outcome and acceptance

Users and agents can distinguish exhausted calendar results from partial or
unavailable results and can retrieve subsequent matching events within the
tool's declared limits.

- An empty intermediate page must not produce an unqualified no-events result.
  Follow continuation or expose usable continuation with explicit incompleteness.
- Preserve the requested calendar and time window across pages. Keep bounded
  result behavior; when a limit stops retrieval, make the remaining uncertainty
  visible. Only an exhausted empty query may claim that no events were found.
- A continuation failure must remain distinguishable from complete success;
  retain any partial results honestly. Continuation must not loop indefinitely
  on a repeated token or invalid response.
- Verify these outcomes through the real tool with controlled HTTP responses,
  including an empty page followed by an event, a terminal empty query, a
  limited partial result and a continuation error. Retain a tool transcript.

Keep ownership in `src/modules/google-workspace/calendar.ts` and its existing
verification. Archived Google Workspace creation/testing and inbound-signal
tasks do not address this pagination defect. This task does not require a new
calendar planner, free/busy service or live-account setup.
