---
id: task-emit-typed-daemon-config-reload-events-into-tracing
title: Emit typed daemon config reload events into tracing and event streams
status: ready
priority: p2
area: runtime
summary: Make daemon config reloads emit a typed event with changed modules, full-reload status, and active workflow count, then route that event through tracing and daemon event catch-up so config changes are observable beyond the caller that invoked reload.
created_at: 2026-05-17T03:03:35Z
updated_at: 2026-05-17T03:03:35Z
---

## Problem

`kota daemon reload` and `POST /reload` now reload config and return
`changedModules`, but the reload is only visible to the caller that made the
request and to daemon text logs. Other clients connected to the daemon event
stream, the event ring buffer, and OpenTelemetry traces cannot reconstruct
that the runtime's effective configuration changed.

That leaves a real operator gap: a workflow run, session, or client issue that
starts immediately after a reload has no typed event tying it to a changed
module set, a full reload, or a no-op reload. The current reload path already
computes the useful facts; it just does not publish them through KOTA's normal
runtime observability contracts.

## Desired Outcome

Daemon config reload attempts produce a typed runtime event that is available
through the same bus, SSE, event-ring, tracing, and metrics paths used for
workflow/session state. A successful reload event records at least:

- whether the reload was full or module-scoped
- the changed module names
- the active workflow definition count after reload
- a stable timestamp and request outcome

Reload failures are also visible as a typed event or typed trace/metric record
without leaking raw config values or secrets. Operators should be able to
answer "what changed just before this run/session behaved differently?" from
daemon events or traces, not only from the CLI transcript that invoked reload.

## Constraints

- Do not add a new config-audit store or parallel changelog. Use typed bus
  events, the existing daemon event ring, and the tracing module.
- Do not include raw config values, tokens, paths containing secrets, or full
  module config blobs in the event payload. Module names, reload kind, counts,
  and error class/message are enough.
- Keep the daemon-owned protocol typed in code and focused tests. Do not add a
  docs catalog of event names.
- The reload handler must not re-read or reload config twice just to create the
  event. Publish facts already produced by the existing reload path.
- Multi-project daemon behavior must stay explicit: if config reload is still
  daemon-wide, the event payload should say so instead of pretending the reload
  belonged to one project.
- The tracing module should subscribe through its normal module lifecycle; do
  not import tracing from core.

## Done When

- A successful `POST /reload` emits a typed config-reload event whose payload
  includes `changedModules`, full-vs-module-scoped status, workflow count, and
  timestamp.
- The daemon event ring and SSE event stream expose the reload event so clients
  that reconnect after reload can catch up.
- The tracing module records reload attempts in OpenTelemetry with attributes
  for outcome, changed module count, full reload, and workflow count.
- A failed reload path is observable without exposing raw config contents.
- Tests cover successful reload, no-op reload, failed reload, event-ring
  visibility, and tracing consumption.

## Source / Intent

Explorer run `2026-05-17T03-00-18-641Z-explorer-zm4w0s` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` are all still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Emit typed daemon config reload events into tracing and event streams" --state ready --area runtime --priority p2 --summary "Make daemon config reloads emit a typed event with changed modules, full-reload status, and active workflow count, then route that event through tracing and daemon event catch-up so config changes are observable beyond the caller that invoked reload."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

External signals checked:

- `https://github.com/anthropics/claude-code/releases` latest entries continue
  hardening long-lived background sessions: model/effort and settings are
  preserved across idle/wake and background respawn, and hook output now has a
  typed terminal-sequence field.
- `https://github.com/livekit/agents/releases` latest `livekit-agents@1.5.9`
  emits agent configuration updates in OTLP session logs.

KOTA should not copy either product surface, but both reinforce the same local
gap: configuration changes in long-lived agent runtimes should be first-class
observable runtime facts.

Local evidence:

- `src/core/daemon/daemon-handle.ts` computes `changedModules` and logs reload
  details, but returns them only to the caller.
- `src/core/daemon/daemon-control-workflow.ts` turns reload results into a
  response body but emits no typed event.
- `src/core/events/event-bus-types.ts` has typed workflow/session events but no
  daemon config reload event.
- `src/modules/tracing/index.ts` subscribes to workflow/session events; it
  cannot trace config reloads because no event exists.

## Initiative

Runtime observability: daemon-visible changes that alter subsequent runs should
be reconstructible from typed runtime events and traces, not only from the
operator command that caused them.

## Acceptance Evidence

- Focused test transcript for daemon reload and tracing coverage, for example
  `pnpm test src/core/daemon/daemon-control.test.ts src/modules/tracing/tracer.test.ts`.
- A runtime probe artifact under `.kota/runs/<run-id>/config-reload-event-probe.json`
  showing `POST /reload` followed by event catch-up containing the typed reload
  event.
*** End Patch
