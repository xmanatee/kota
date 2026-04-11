# Webhook Channel Module

This module provides a generic inbound HTTP webhook channel. External services
POST a JSON payload to create or resume agent sessions.

- Implements the `ChannelDef` protocol from `src/core/channels/channel.ts`.
- Registers a `POST /api/channels/webhook` route via module route contribution.
- Supports optional HMAC-SHA256 signature verification.
- Separate from the outbound `webhook` notification module.
