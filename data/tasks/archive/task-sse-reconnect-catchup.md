---
status: done
---

# Resume SSE event stream with ring-buffer catchup after reconnect

## Problem

When the `EventSource` connection drops and reconnects, `connectDaemonEvents` opens a
fresh stream with no `since` parameter. Any events emitted during the outage window are
silently skipped. The UI falls back to 30-second polling intervals to eventually recover,
but runs that started and finished during the gap will not appear until the next poll.

The daemon control server already supports a `since=<ISO timestamp>` query parameter on
`GET /api/daemon/events` and backs it with an in-memory `EventRingBuffer` (default 500
entries). The client is not using this facility.

## Desired Outcome

On reconnect, the SSE URL includes `since=<lastEventTimestamp>` so the server replays
buffered events from the ring buffer before resuming the live stream. The web UI
reflects the correct state immediately after reconnect rather than waiting for a polling
cycle.

- Track the timestamp of the last successfully received SSE event.
- On reconnect, append `since=<lastEventTimestamp>` to the `EventSource` URL.
- No new API changes required; the server already handles `since`.
- On initial connect (no prior timestamp), open without `since` as today.

## Constraints

- Change confined to `client-workflows.ts` (`connectDaemonEvents` function).
- Do not break the `onerror` → reconnect flow already in place.
- Do not introduce a hard dependency on event ordering beyond what the ring buffer guarantees.

## Done When

- After a simulated SSE disconnect, the reconnect URL includes `since=<lastEventTimestamp>`.
- Events buffered during the gap are delivered immediately on reconnect.
- `web-ui.test.ts` covers the reconnect-with-since path.
