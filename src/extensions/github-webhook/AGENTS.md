# GitHub Webhook Extension

This directory owns the GitHub webhook ingestion extension — receives GitHub webhook deliveries and emits typed bus events.

- Registers `POST /api/webhooks/github` and validates each delivery's `X-Hub-Signature-256` HMAC before emitting `github.<event>` bus events.
- Requires `extensions.github-webhook.secret`. The route is not registered when the secret is missing.
- Invalid signatures are rejected with HTTP 401; unrecognised event types return HTTP 200 with `ignored: true`.

## Files

- `index.ts` — `KotaExtension` definition; implements route registration, HMAC validation, and bus event emission.
- `github-webhook.test.ts` — unit tests for webhook signature validation and event emission.

## Boundaries

- Does not own GitHub API calls or PR/issue tools (those belong in `github/`).
- Does not own inbound webhook routing for other services (other webhook extensions are separate).
- Does not own outbound HTTP notification delivery (that belongs in `webhook/`).
