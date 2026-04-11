---
id: task-channel-user-identity-context
title: Add user-identity fields to ChannelStartContext
status: ready
priority: p2
area: core
summary: ChannelStartContext lacks user/operator identity fields, forcing each channel adapter to reimplement identity propagation independently.
created_at: 2026-04-11T17:03:00Z
updated_at: 2026-04-11T17:03:00Z
---

## Problem

The channel protocol in `src/core/channels/channel.ts` defines
`ChannelStartContext` without any user or operator identity fields. Every
channel adapter that needs to know who initiated a session (Telegram user ID,
Slack user, email sender) must handle identity extraction and propagation on
its own. This duplicates work across adapters and makes it impossible for
downstream components (guardrails, audit logging, cost attribution) to
reliably identify the requesting user without channel-specific knowledge.

## Desired Outcome

`ChannelStartContext` gains a small, typed identity surface (e.g. `operator`
string and optional `identity` metadata record) that adapters can populate
during channel start. Sessions created from channel messages carry this
identity forward so that guardrails, audit events, and cost tracking can
attribute actions without reaching back into channel-specific state.

## Constraints

- Keep the identity surface minimal and optional so existing adapters continue
  to work without changes.
- Do not introduce an auth/authz framework. Identity here is informational,
  not access-control.
- Update at least one existing channel adapter (e.g. Telegram) to populate the
  new fields as a reference implementation.
- Update `docs/NOTIFICATIONS.md` or channel docs if the operator config
  surface changes.

## Done When

- `ChannelStartContext` has typed identity fields.
- At least one channel adapter populates them.
- Sessions created via that adapter carry the identity in their metadata.
- Existing adapters that do not populate identity still start cleanly.
