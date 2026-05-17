# GitHub Webhook Module

This directory owns the GitHub webhook ingestion module — receives GitHub webhook deliveries and emits typed bus events.

- Registers its HTTP route through the module route system and validates each
  delivery's GitHub HMAC signature before emitting normalized bus events.
- Requires a configured secret. The route is not registered when the secret is
  missing.
- Invalid signatures are rejected; unrecognized event types are acknowledged and
  ignored.
- Signature validation uses `timingSafeEqual` to prevent timing attacks.
- Pull-request events own actor-integrity normalization at this boundary.
  Preserve the distinction between webhook authenticity, normalized actor
  trust metadata, and downstream prompt-injection labeling.

## GitHub Setup

On GitHub, configure a repository webhook to point at the KOTA-hosted route and
use the same secret as the module config. Keep accepted delivery types and
normalized payload fields in code and tests.

## Boundaries

- Does not own GitHub API calls or PR/issue tools (those belong in `github/`).
- Does not own inbound webhook routing for other services (other webhook modules are separate).
- Does not own outbound HTTP notification delivery (that belongs in `webhook/`).
