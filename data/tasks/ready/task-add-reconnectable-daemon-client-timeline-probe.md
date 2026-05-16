---
id: task-add-reconnectable-daemon-client-timeline-probe
title: Add reconnectable daemon-client timeline probe
status: ready
priority: p2
area: architecture
summary: Add a local runtime probe proving daemon clients can reconnect and reconstruct active sessions, workflow runs, approvals, and timeline events from the control API plus SSE without becoming the source of truth.
created_at: 2026-05-16T01:57:48.915Z
updated_at: 2026-05-16T01:57:48.915Z
---

## Problem

Codex has moved its coding-agent runtime toward a reconnectable remote-control
shape: OpenAI's App Server writeup describes durable thread/turn/item
primitives, bidirectional approvals, saved thread state, and client
reconnection; the May 14, 2026 mobile announcement adds a phone client that can
inspect active work, approvals, diffs, terminal output, screenshots, tests, and
project context through a secure relay while the files and credentials remain
on the machine running Codex.

KOTA has the right public concepts already: daemon-owned sessions, workflow
runs, bus events, approval queue, SSE, and thin clients. What is not proven as a
single invariant is the remote-client contract: after a disconnect, can a client
reconnect to the daemon, reconstruct the active session/run timeline, see
pending approvals, and continue without becoming the source of truth itself?
Without that probe, future mobile or remote-control work can accidentally turn
into per-client state reconstruction instead of a daemon protocol guarantee.

## Desired Outcome

A local runtime probe and focused tests prove KOTA's daemon-control surface is
reconnectable for remote clients. The probe should boot a daemon against a
temporary project, drive a small interactive/session workflow, deliberately
drop and reopen the event stream, then assert the client can rebuild the same
state from daemon HTTP plus SSE catch-up:

- active sessions and workflow runs are discoverable after reconnect;
- pending approval / owner-input state is visible and resolvable through the
  existing approval and owner-question surfaces;
- timeline events have enough stable identity to avoid duplicate rendering
  after reconnect;
- run artifacts, command output, diffs, and test/probe results are reachable
  by reference rather than copied into a client-local store;
- no client-side cache is required to decide what is live.

## Constraints

- Build on the existing daemon control API, module-contributed client
  namespaces, approval queue, run store, and SSE/event-ring mechanisms. Do not
  add a second app-server protocol, workflow engine, or client-local session
  store.
- Keep any future public relay out of this task. This task proves the local
  daemon contract that a relay or mobile app would sit in front of.
- Treat clients and channels separately per `docs/ARCHITECTURE.md`: this is a
  daemon-client reconnection proof, not a new external interaction channel.
- If the probe finds that a required state class is not reconstructible, fix
  the daemon/event/run boundary or open a precise follow-up. Do not paper over
  missing state by injecting a precomputed summary into the client.
- Keep the evidence headless and repeatable; rendered mobile/web screenshots
  belong to later surface work, not this architecture probe.

## Done When

- A test or probe boots the daemon locally and exercises a reconnect sequence
  that covers at least one active session, one workflow run, one pending
  approval or owner-question decision, and one artifact-backed output.
- The probe asserts state equivalence before and after reconnect using typed
  daemon-client responses and SSE/event records, including duplicate-event
  prevention.
- The implementation documents the remote-client reconnection contract at the
  narrowest relevant scope if code alone does not make it obvious.
- Any missing daemon-control field needed for reconnection is added as a
  strict typed protocol field, not as an optional compatibility fallback.
- The work leaves the public mechanism as "client talks to daemon control
  API/SSE"; no new relay, tunnel, or hosted dependency is introduced.

## Source / Intent

Explorer run `2026-05-16T01-54-25-903Z-explorer-it4ose` reviewed current
Codex signals while the KOTA queue was empty:

- `https://openai.com/index/unlocking-the-codex-harness/` describes Codex's
  App Server as the reusable harness boundary, with durable thread/turn/item
  primitives, bidirectional client/server notifications, approvals that pause a
  turn until the client answers, and reconnectable web sessions.
- `https://openai.com/index/work-with-codex-from-anywhere/` announces Codex in
  the ChatGPT mobile app on May 14, 2026, including remote inspection and
  steering of active threads, approvals, diffs, terminal output, tests, and
  project context through a secure relay.
- `https://github.com/openai/codex` release data observed during the run shows
  Codex CLI/App Server continuing to move quickly, with the May 8, 2026 stable
  release adding `codex remote-control` and app-server thread paging.

The architectural takeaway is not to copy Codex's protocol. KOTA already has a
daemon/session/workflow/client model. The next useful slice is proving that
KOTA's existing daemon protocol can support reconnectable remote clients before
any UI fan-out or relay work begins.

## Initiative

Remote-capable daemon clients: KOTA clients should be able to inspect and steer
long-running local work through the daemon without owning runtime state.

## Acceptance Evidence

- A committed test or probe command, for example
  `pnpm test src/daemon-remote-reconnect.integration.test.ts`, fails if a
  client cannot reconstruct the active session/run/approval timeline after an
  SSE disconnect and reconnect.
- A transcript or JSON probe artifact under
  `.kota/runs/<run-id>/remote-client-reconnect/` records daemon boot, event
  stream disconnect, reconnect, state rebuild, approval/owner-question
  resolution, and final equivalence assertions.
- The probe output names any skipped dependency explicitly; it must not pass
  silently because a daemon route, event stream, or approval surface was absent.
