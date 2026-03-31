---
id: task-web-ui-live-updates
title: Replace web UI dashboard polling with SSE-based live updates
status: ready
priority: p3
area: operator-ux
summary: The web UI dashboard refreshes workflow status, sessions, tasks, and approvals via setInterval polling (every 5–30 seconds). The daemon already supports SSE for workflow events. Switching the dashboard panels to SSE would make status changes instant and eliminate unnecessary round-trips.
created_at: 2026-03-31T08:16:57Z
updated_at: 2026-03-31T08:31:48Z
---

## Problem

`src/web-ui/client.ts` drives all dashboard updates with `setInterval` calls: workflow status every 30s, sessions every 15s, cost every 5s, approvals every 30s. This means a newly submitted approval or a completed workflow run may not appear in the UI for up to 30 seconds. The daemon already has an SSE endpoint (`GET /workflow/events`) used by the workflow follow command; the web dashboard doesn't use it.

## Desired Outcome

- The dashboard subscribes to the daemon's SSE event stream on load.
- Relevant bus events (`approval.changed`, `workflow.run.started`, `workflow.run.finished`, `session.*`) trigger targeted panel refreshes immediately.
- Polling intervals for event-driven panels (workflows, approvals, sessions) are removed or extended to a long fallback (e.g., 5 minutes) for resilience.
- Cost polling can remain since it is not event-driven.
- Connection loss is handled gracefully: show a "reconnecting..." indicator and fall back to polling until SSE reconnects.

## Constraints

- No new server-side SSE endpoints needed — use the existing `/workflow/events` stream or a new `/events` stream that the daemon already has capability for.
- Keep the polling fallback in case SSE is unavailable (offline daemon, browser doesn't support EventSource).
- Do not change the daemon-control API or add new bus events; only consume existing ones in the web UI client.
- No new npm dependencies.

## Done When

- Dashboard panels update within 2 seconds of relevant bus events.
- Polling intervals for event-driven panels are removed or set to ≥5 minutes.
- SSE reconnect is handled gracefully with a UI indicator.
- Existing web UI tests pass.
