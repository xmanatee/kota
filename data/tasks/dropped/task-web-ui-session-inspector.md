---
id: task-web-ui-session-inspector
title: Add active session inspector panel to the web UI dashboard
status: dropped
priority: p3
area: operator-ux
summary: Active interactive sessions (kota serve instances) are visible via GET /status but have no web dashboard panel. An inspector panel lets operators see who is connected, how long they have been running, and their session metadata without using the CLI.
created_at: 2026-03-31T03:42:35Z
updated_at: 2026-03-31T04:25:00Z
---

## Why Dropped

Dropped in `074e0e65` as pre-implemented, and the current React dashboard still
covers it: `clients/web/src/components/sidebar/SessionList.tsx` and
`ActiveSessionsPanel.tsx` consume `/api/sessions`, while daemon events
invalidate session queries on `session.registered` and `session.unregistered`.
The operator visibility need is not stale.

## Problem

When `kota serve` is running, the daemon tracks the session via `POST /sessions/register`.
`GET /status` returns active sessions alongside active workflow runs. However, the web
dashboard has no panel that surfaces this information. Operators cannot see from the
dashboard whether anyone is currently in an interactive session, how long it has been
running, what agent it is using, or whether it has been idle. They must use the CLI
(`kota session list`) or read the raw API.

## Desired Outcome

A Sessions panel in the web dashboard that:

- Lists all currently active interactive sessions (id, started at, agent, last activity).
- Updates in near-real-time via the existing SSE stream when sessions register or unregister.
- Shows basic metadata: session ID (shortened), agent name, start time, elapsed time.
- Distinguishes interactive sessions from workflow agent sessions.

No session control is needed in v1 — read-only visibility is enough.

## Constraints

- Source all data from `GET /status` on the daemon control API; no new endpoints required.
- Use the same SSE wiring and component patterns as existing dashboard panels.
- Update on `session.registered` and `session.unregistered` bus events, or fall back to
  polling `GET /status` if those events are not yet emitted.
- Panel should render an empty state gracefully when no sessions are active.
- Keep the panel read-only; no terminate or interrupt actions in this task.

## Done When

- Sessions panel renders in the web dashboard with active session list from daemon API.
- Panel shows session id, agent, start time, and elapsed duration.
- Panel updates when sessions start or end without full page reload.
- Existing dashboard panels and tests are unaffected.
- At least one render test covers the new panel.
