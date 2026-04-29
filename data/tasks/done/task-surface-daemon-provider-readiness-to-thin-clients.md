---
id: task-surface-daemon-provider-readiness-to-thin-clients
title: Surface daemon provider readiness to thin clients
status: done
priority: p1
area: architecture
summary: Expose provider/capability readiness through daemon status or a focused endpoint so thin clients can distinguish daemon connectivity from unavailable knowledge, memory, history, recall, answer, capture, and task semantic providers before rendering broken controls.
created_at: 2026-04-28T22:35:18.039Z
updated_at: 2026-04-29T02:00:22.824Z
---

## Problem

Thin clients currently infer capability state by calling individual routes and
rendering whatever error comes back. That makes a connected daemon look broken:
the macOS menu bar can show "1 run active" while Knowledge, Memory, History,
Recall, and Answer all show runtime errors.

Daemon `/health` can report module health, and some routes return typed
`semantic_unavailable` responses, but there is no single thin-client contract
that answers "which operator capabilities are usable right now and why?"

## Desired Outcome

The daemon exposes a typed provider/capability readiness summary that all thin
clients can consume before rendering controls:

- knowledge search readiness;
- memory search readiness;
- history search readiness;
- repo-task semantic search readiness;
- recall readiness;
- answer readiness;
- capture/retract contributor readiness;
- dashboard/web UI availability;
- workflow trigger definitions availability.

Clients can then disable, hide, badge, or explain unavailable controls without
throwing generic route errors.

## Constraints

- Do not require optional providers to be configured for the daemon to be
  healthy. Distinguish "daemon degraded" from "optional capability unavailable".
- Reuse existing module health/provider checks where possible; do not create a
  second inconsistent registry.
- Keep the response typed and stable enough for macOS, mobile, web, CLI,
  Telegram, and Slack clients to consume.
- Avoid leaking secrets, full config values, or agent prompt content.
- Coordinate with `task-define-and-enforce-thin-client-capability-contract`.

## Done When

- The daemon exposes a typed readiness shape through `/status`, `/health`, or a
  focused capability endpoint.
- Provider-backed modules populate readiness with actionable reason codes and
  short operator-facing messages.
- At least two clients or client contract tests consume the readiness shape
  rather than discovering unavailability through route failures.
- Existing semantic-unavailable behavior remains compatible for callers that
  hit a route directly.
- Tests cover ready, unavailable, and initialization-failed cases.

## Source / Intent

2026-04-28 macOS menu bar incident: once connected to the right project, the app
displayed multiple generic errors because provider-backed routes were exposed
without usable providers. Even after daemon startup is fixed, a project can
legitimately lack embedding-backed providers. Thin clients need a first-class
readiness contract instead of treating every unavailable optional capability as
a surprise failure.

## Initiative

Thin-client reliability: clients render daemon capabilities from an explicit
contract instead of guessing from ad hoc route failures.

## Acceptance Evidence

- Example JSON from the readiness endpoint showing ready and unavailable
  capabilities.
- Tests demonstrating clients can distinguish daemon offline, daemon online but
  capability unavailable, and capability route failure.
- A rendered transcript or screenshot from at least one client showing a disabled
  or explained unavailable capability instead of a generic error.
