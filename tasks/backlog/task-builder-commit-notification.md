---
id: task-builder-commit-notification
title: Emit a bus event when builder successfully commits so channel extensions can notify the operator
status: backlog
priority: p3
area: runtime
summary: When the builder commits changes it emits no notification event. Operators who want to track what was just built must poll the web UI or wait for the attention digest (which fires every 10 runs and only when problems exist). A lightweight commit event would let Telegram/Slack subscribers receive an immediate summary.
created_at: 2026-04-02T07:51:00Z
updated_at: 2026-04-02T07:51:00Z
---

## Problem

After a successful builder commit, no bus event is emitted. Channel extensions
(Telegram, Slack, webhook) subscribe to bus events to send operator notifications,
but there is nothing for them to subscribe to when builder ships something. The
attention digest (`workflow.attention.digest`) only fires every 10 builder runs and
only when one of its health checks triggers — it does not fire on a normal successful
run. The only way to know builder committed is to poll the web UI or read
`.kota/runs/` manually.

This makes it hard to stay informed during an active development session where builder
is running frequently.

## Desired Outcome

After `write-run-summary` succeeds in the builder workflow, a `workflow.build.committed`
bus event is emitted with:

```json
{
  "runId": "...",
  "taskId": "task-foo-bar",
  "commitMessage": "first line of the commit message",
  "costUsd": 0.42,
  "durationMs": 480000
}
```

Telegram and Slack extensions subscribe to this event and send a compact message:

```
✅ Builder committed: Add foo bar support
Task: task-foo-bar · $0.42 · 8m
```

## Constraints

- The event is emitted only when the commit step succeeds (`stepCommitted("commit")`).
  Skipped builds (no actionable tasks) do not emit the event.
- The Telegram and Slack extensions subscribe via `ExtensionEventProxy.subscribe()` in
  `onLoad`, following the same pattern as `workflow.failure.alert`.
- The event is opt-in per-extension: add `build.committed` to the event filter list
  alongside the other notification events (default: off, to avoid noise for operators
  who run builder frequently).
- `BusEvents` in `event-bus-types.ts` must include the new event type.
- Document the event in `docs/WORKFLOWS.md` under operator notifications.

## Done When

- Builder emits `workflow.build.committed` after a successful commit step.
- Telegram extension subscribes and sends a commit summary message when the event fires.
- Slack extension subscribes and sends an equivalent Block Kit message.
- The event is listed in `BusEvents` with full type.
- `docs/WORKFLOWS.md` documents the event and its payload.
- Unit test verifies the event is emitted with the correct payload shape.
