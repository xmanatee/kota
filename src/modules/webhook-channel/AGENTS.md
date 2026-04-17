# Webhook Channel Module

This module provides a generic inbound HTTP webhook channel. External services
POST a JSON payload to create or resume agent sessions.

- Implements the `ChannelDef` protocol from `src/core/channels/channel.ts`.
- Registers its HTTP route via module route contribution.
- Supports optional HMAC-SHA256 signature verification.
- Supports source-based routing to different agents with per-source session continuity.
- Separate from the outbound `webhook` notification module.
- `handler.ts` owns types, helpers, source resolution, and request handling.
- `index.ts` owns the module definition and route registration.
