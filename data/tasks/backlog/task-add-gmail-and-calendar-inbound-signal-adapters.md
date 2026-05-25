---
id: task-add-gmail-and-calendar-inbound-signal-adapters
title: Add Gmail and Calendar inbound-signal adapters
status: backlog
priority: p2
area: modules
summary: Normalize configured Gmail and Calendar changes into inbound.signal.received events for bounded workflows.
created_at: 2026-05-25T02:48:53.897Z
updated_at: 2026-05-25T02:48:53.897Z
---

## Problem

Google Workspace currently exposes Gmail and Calendar as agent tools, but it
does not contribute inbound Gmail or calendar change signals to the daemon
event model.

## Desired Outcome

Configured Gmail messages and Calendar changes can enter KOTA as
`inbound.signal.received` payloads with project scope, Google account identity,
sender/organizer trust metadata, source ids, timestamps, and normalized
message or calendar action content.

## Constraints

- Keep Gmail and Calendar adapters thin; do not add provider-local task
  planners or calendar automation loops.
- Workflows decide task capture/update, knowledge capture, replies, owner
  questions, approval posture, retries, audit, and no-op behavior.
- Preserve enough Google source metadata for later workflow review without
  treating email or calendar text as trusted instructions.

## Done When

- Gmail and Calendar inbound adapters emit the shared typed signal for
  configured sources.
- Tests cover trusted and untrusted sender/organizer normalization.
- A focused workflow-dispatch test proves a Google-origin signal can route to a
  bounded workflow decision.

## Source / Intent

Follow-up from `task-define-inbound-channel-automation-as-typed-daemon-`.
The owner request explicitly named Gmail/email and Calendar as desired daemon
entry points for bounded automation.

## Initiative

Channel-driven automation.

## Acceptance Evidence

- Tests covering Gmail and Calendar adapter normalization, event validation,
  and workflow dispatch from at least one Google-origin signal.
- Transcript or fixture showing project scope and trust metadata on a sample
  Gmail or Calendar inbound signal.
