---
id: task-web-ui-run-detail-permalink
title: Add URL deep linking for web UI run detail panel
status: backlog
priority: p3
area: operator-ux
summary: Opening a run detail in the web UI does not update the browser URL, making it impossible to bookmark or share a link to a specific run. A URL hash approach would let operators link directly to a run from Slack, email, or docs.
created_at: 2026-04-02T01:06:00Z
updated_at: 2026-04-02T01:06:00Z
---

## Problem

When an operator opens a run detail panel in the web UI (`showRunDetail(runId)`), the
browser URL does not change. There is no way to share or bookmark a specific run:
every link resolves to the dashboard root, and the viewer must manually find the run
in the history list.

Operators discussing an incident in Slack or writing a postmortem often want to link
directly to the run that failed or the run that produced a specific artifact. Currently
this requires opening the run by hand and describing which one it is.

## Desired Outcome

- When a run detail panel opens, the browser URL updates to include the run ID
  (e.g. via `location.hash = "#run=" + runId` or `history.pushState`).
- When the page loads with a `#run=<runId>` hash present, the detail panel for that
  run opens automatically after the initial workflow history fetch completes.
- When the detail panel is closed (Back button or Escape), the URL hash is cleared.
- The token query parameter is stripped before setting the hash (existing behavior
  in `client.ts` already removes the token from the URL on load).

## Constraints

- Hash-based routing only; do not introduce a client-side router or path-based URLs.
  The web UI is a single-page app served from one route; hash changes do not trigger
  a server request.
- The auto-open on load should silently skip if the run ID is not found in the initial
  history fetch (stale or deleted run).
- No changes to the server-side routes or daemon API.
- Existing keyboard navigation (`j/k` to cycle runs, Escape to close) must still work
  after this change.

## Done When

- Opening a run detail updates `location.hash` to `#run=<runId>`.
- Closing the detail panel clears the hash.
- Loading the page with `#run=<runId>` auto-opens that run detail if the run is in
  the recent history list.
- At least one test covers hash-set-on-open and hash-clear-on-close behavior.
