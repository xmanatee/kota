---
id: task-web-ui-live-log-streaming
title: Stream live step output in the web UI run detail view
status: doing
priority: p2
area: web-ui
summary: The run detail view shows step outputs as static snapshots fetched after the run completes. While a run is active, operators can see nothing in real time. An SSE endpoint for the active run would let the detail view tail live output without polling.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The web UI run detail view uses `/api/workflow/runs/:id` to render step results, but that data is only present after the run finishes. During an active run, operators must use `kota logs --follow` at the CLI or wait for the run to complete. The web UI provides no live visibility into what the autonomous system is doing right now.

## Desired Outcome

- A new `/api/workflow/runs/:id/stream` SSE endpoint emits step-level events (step started, step output chunk, step finished) for a running or recently completed run.
- The run detail view connects to this endpoint when the selected run is in `running` status and streams output into the step rows in real time.
- Once the run completes, the stream closes and the view transitions to the static finished state.
- Falls back gracefully to the existing static view if SSE is unavailable or the run is already done.

## Constraints

- No framework dependencies — keep it vanilla JS on the client side.
- SSE is preferred over polling or WebSocket; it is simpler and sufficient for append-only log streams.
- Do not buffer the full run output in memory for streaming; tail from the run directory on disk.
- The endpoint should close cleanly when the run ends or the client disconnects.
- If the run ID is not found or not running, return 404 — do not block.

## Done When

- Active run detail view streams step output to the browser in real time.
- Completed run detail view still renders via the existing static endpoint.
- Stream endpoint handles run-not-found and run-already-done cases.
- No memory leak on long-running or frequently-opened streams.
