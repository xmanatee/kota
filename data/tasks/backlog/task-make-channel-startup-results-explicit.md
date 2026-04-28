---
id: task-make-channel-startup-results-explicit
title: Make channel startup results explicit
status: backlog
priority: p2
area: architecture
summary: Replace ChannelDef.create returning null with a typed startup result so disabled, unavailable, and failed channels are visible to operators instead of silently skipped.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-04-28T22:24:00.000Z
---

## Problem

`ChannelDef.create(ctx)` returns `ChannelAdapter | null`, and the protocol
comment says the daemon skips null channels silently. This hides important
operational distinctions:

- The channel is intentionally disabled by config.
- Credentials are missing.
- A dependency is unavailable.
- Startup failed unexpectedly.

Silent null is convenient, but it is not robust operator infrastructure.

## Desired Outcome

Channel startup returns a typed result:

- `started` with the adapter.
- `disabled` with a reason.
- `unavailable` with a missing config/secret/capability reason.
- `failed` with an error summary.

Daemon status, health checks, and operator surfaces can show the channel
posture. Optional channels still degrade cleanly, but operators can see why a
channel is not running.

## Constraints

- Do not make optional channels fail daemon startup merely because credentials
  are absent.
- Do fail loudly for unexpected startup errors that currently would be hidden.
- Keep secrets masked in channel status.
- Update channel modules consistently rather than leaving mixed return shapes.

## Done When

- `ChannelDef.create` returns a discriminated `ChannelStartResult` or
  equivalent.
- Existing channel modules migrate from `null` to explicit `disabled` /
  `unavailable` / `failed` results.
- Daemon/module status can show non-started channel reasons without exposing
  secrets.
- Tests cover disabled, missing-credential, and thrown-error startup paths.

## Source / Intent

2026-04-28 protocol review found `src/core/channels/channel.ts` documents
silent null channel skips. The owner asked for robust and reliable protocols;
silently skipped integration surfaces are the opposite of that.

External comparison:

- Claude Code settings and hooks use explicit scoped configuration and
  lifecycle events; channel startup should be equally inspectable.

## Initiative

Operator reliability: make integration posture observable so channels fail
closed, disabled, or unavailable for explicit reasons.

## Acceptance Evidence

- Unit tests for every channel startup result arm.
- Operator-facing status output or API fixture showing a disabled/unavailable
  channel reason with secrets masked.
- Existing channel tests remain green.

