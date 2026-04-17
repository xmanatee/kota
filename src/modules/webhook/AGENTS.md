# Webhook Module

This directory owns the outbound webhook notification module and the CLI commands for managing inbound webhook secrets.

- Outbound notifications POST event payloads to configured operator endpoints.
- Optional event filters must not suppress urgent owner/approval escalation
  notifications.
- CLI commands (`kota webhook list`, `kota webhook secret generate`, `kota webhook secret remove`) manage inbound webhook trigger secrets stored in `.kota/config.json`.
- Uses `postWithRetry` from the `notification` module for delivery with exponential-backoff retry.
- Declares a dependency on the `notification` module.

## Boundaries

- Does not own inbound webhook ingestion (that belongs in `github-webhook/` for GitHub, or user modules for other sources).
- Does not own Slack or Telegram notification (those belong in `slack/` and `telegram/`).
- Does not own retry logic (that lives in the `notification` module).
