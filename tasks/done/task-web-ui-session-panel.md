---
id: task-web-ui-session-panel
title: Add active sessions panel to the web UI dashboard
status: done
priority: p3
area: operator-ux
summary: The daemon tracks active interactive and workflow agent sessions, but the web dashboard has no panel showing live session activity alongside workflow runs and approvals.
created_at: 2026-03-30T19:57:00Z
updated_at: 2026-03-30T20:20:00Z
---

## Problem

The daemon now routes all sessions through its control API (`GET /status` returns
`activeSessions` alongside `workflow.activeRuns`). The web dashboard shows workflow
runs, approvals, and task queue, but has no visibility into which CLI or agent sessions
are currently active. An operator watching the dashboard cannot tell if an interactive
`kota serve` session is live or what agent a workflow session is running.

## Desired Outcome

A "Sessions" panel in the web UI dashboard that:
- Lists active sessions (id, type: interactive/workflow, agent, start time).
- Updates in real-time via the existing SSE `/events` stream when sessions register
  or unregister (daemon emits `session.registered` and `session.unregistered` events
  at the relevant `POST /sessions/register` and `DELETE /sessions/:id` call sites).
- Shows a clear "no active sessions" state when idle.

The panel does not need session control (no abort/interrupt); read-only display is enough.

## Constraints

- Use the existing SSE client wiring and panel component patterns from approvals/tasks panels.
- Add `session.registered` and `session.unregistered` to `BusEvents` in `event-bus-types.ts`;
  emit them from the daemon session registration handlers in `daemon-control.ts`.
- No new REST endpoints needed — initial state comes from `GET /status`.
- Session panel sits alongside the existing approvals, tasks, and workflow panels.

## Done When

- Sessions panel renders in the web UI with live data from `GET /status`.
- SSE events update the panel without polling.
- Panel shows correct empty state when no sessions are active.
- Existing web UI tests pass; new behavior covered by at least one test.
