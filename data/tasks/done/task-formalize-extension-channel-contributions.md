---
id: task-formalize-module-channel-contributions
title: Formalize channel contributions in the module protocol
status: done
priority: p2
area: modules
summary: ARCHITECTURE.md states that modules can contribute channels, but KotaModule has no channels field. The Telegram channel is hardcoded in the daemon rather than contributed via the module protocol. Formalizing this closes the gap between the stated architecture and the implementation.
created_at: 2026-03-30T00:00:00Z
updated_at: 2026-03-30T15:34:00Z
---

## Problem

`ARCHITECTURE.md` lists `channel` as a first-class concept that modules
should be able to contribute: "An module can contribute tools, skills,
agents, workflows, channels, and internal services." However, `KotaModule`
in `src/module-types.ts` has no `channels` field. The Telegram channel is
wired directly in the daemon rather than registered through the module
protocol.

This means:
- No external module can add a new channel (Slack, email, web chat, etc.)
  without forking daemon internals.
- The channel concept is documented as part of the module protocol but not
  implemented there.
- The Telegram module's channel role is implicit, not declared.

## Desired Outcome

- `KotaModule` gains a `channels` field following the same pattern as
  `workflows`, `tools`, and `agents`.
- A `ChannelDef` type captures the channel protocol: session routing policy,
  inbound/outbound transport hooks, and operator identity.
- The Telegram channel is refactored to be a contributed channel via the
  module protocol rather than a hardcoded daemon subscription.
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

- `KotaModule` has a `channels` optional field with a defined `ChannelDef`
  type.
- The Telegram module contributes its channel through this field.
- `ARCHITECTURE.md` reflects the channel contribution model.
- Existing Telegram tests pass unchanged.
- A second module (or a README example) demonstrates that a new channel can
  be contributed without touching daemon internals.
