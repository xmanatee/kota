# GitHub Webhook Module

This directory owns the GitHub webhook ingestion module — receives GitHub webhook deliveries and emits typed bus events.

- Registers `POST /api/webhooks/github` and validates each delivery's `X-Hub-Signature-256` HMAC before emitting `github.<event>` bus events.
- Requires `modules.github-webhook.secret`. The route is not registered when the secret is missing.
- Invalid signatures are rejected with HTTP 401; unrecognised event types return HTTP 200 with `ignored: true`.

## Event Payload Docs

The normalized payload shapes for each emitted `github.*` event are documented in `docs/GITHUB-WEBHOOK.md` (under "Bus Events"). If you add or change a field in the normalized payload, update the corresponding table in that file in the same run.

## Boundaries

- Does not own GitHub API calls or PR/issue tools (those belong in `github/`).
- Does not own inbound webhook routing for other services (other webhook modules are separate).
- Does not own outbound HTTP notification delivery (that belongs in `webhook/`).
