# Webhook Module

This directory owns the outbound webhook notification module — routes KOTA notification events to one or more HTTP endpoints via POST.

- Configured via `modules.webhook.urls` (list of POST endpoints).
- `approval.requested` is always forwarded; other events are filtered by the optional `events` array.
- No tools, channels, CLI commands, or workflows — notification delivery only.
- Uses `postWithRetry` from `../notify-retry.ts` for delivery with exponential-backoff retry.

## Files

- `index.ts` — `KotaModule` definition; implements event subscription and JSON payload delivery.
- `webhook.test.ts` — unit tests for event subscription and HTTP delivery.

## Boundaries

- Does not own inbound webhook ingestion (that belongs in `github-webhook/` for GitHub, or user modules for other sources).
- Does not own Slack or Telegram notification (those belong in `slack/` and `telegram/`).
- Does not own retry logic (that lives in `../notify-retry.ts`).
