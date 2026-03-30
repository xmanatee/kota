---
id: task-formalize-extension-channel-contributions
title: Formalize channel contributions in the extension protocol
status: done
priority: p2
area: extensions
summary: ARCHITECTURE.md states that extensions can contribute channels, but KotaExtension has no channels field. The Telegram channel is hardcoded in the daemon rather than contributed via the extension protocol. Formalizing this closes the gap between the stated architecture and the implementation.
created_at: 2026-03-30T00:00:00Z
updated_at: 2026-03-30T15:34:00Z
---

## Problem

`ARCHITECTURE.md` lists `channel` as a first-class concept that extensions
should be able to contribute: "An extension can contribute tools, skills,
agents, workflows, channels, and internal services." However, `KotaExtension`
in `src/extension-types.ts` has no `channels` field. The Telegram channel is
wired directly in the daemon rather than registered through the extension
protocol.

This means:
- No external extension can add a new channel (Slack, email, web chat, etc.)
  without forking daemon internals.
- The channel concept is documented as part of the extension protocol but not
  implemented there.
- The Telegram extension's channel role is implicit, not declared.

## Desired Outcome

- `KotaExtension` gains a `channels` field following the same pattern as
  `workflows`, `tools`, and `agents`.
- A `ChannelDef` type captures the channel protocol: session routing policy,
  inbound/outbound transport hooks, and operator identity.
- The Telegram channel is refactored to be a contributed channel via the
  extension protocol rather than a hardcoded daemon subscription.
- A brief note in `docs/ARCHITECTURE.md` describes the channel contribution
  model.

## Constraints

- Do not redesign the session or channel semantics — only formalize what
  already exists for Telegram into a reusable protocol shape.
- The Telegram behavior must be unchanged after refactoring.
- Keep the channel protocol minimal: routing policy and transport hooks are
  the core; advanced features (rate limiting, multi-tenant session pools)
  can come later.
- Do not require all daemon-owned channels to move before the protocol is
  usable — migrating Telegram is sufficient to prove the shape.

## Done When

- `KotaExtension` has a `channels` optional field with a defined `ChannelDef`
  type.
- The Telegram extension contributes its channel through this field.
- `ARCHITECTURE.md` reflects the channel contribution model.
- Existing Telegram tests pass unchanged.
- A second extension (or a README example) demonstrates that a new channel can
  be contributed without touching daemon internals.
