# Extensions

This directory contains built-in extensions and extension-level wiring.

- Keep built-in extensions isolated behind extension contracts rather than reaching into core internals ad hoc.
- If extension boundaries drift, fix the boundary instead of normalizing the drift.

## Shared Utilities

- `notify-retry.ts` — `postWithRetry`: shared HTTP POST helper with exponential-backoff retry used by the webhook and Slack extensions. Accepts `retries` and `baseDelayMs` options; logs a warning after all attempts are exhausted.

## Built-in Extensions

- `webhook.ts` — HTTP notification extension. POSTs a JSON payload to one or more configured URLs on each notification event. Subscribes to `approval.requested` unconditionally (bypasses the `events` filter); all other notification events are filtered by the optional `events` array. Uses `postWithRetry` for delivery. No tools, channels, or CLI commands.
- `slack.ts` — Slack notification extension. POSTs Block Kit messages to a configured Incoming Webhook URL. Same event subscription pattern as `webhook.ts`: `approval.requested` always forwarded, others filtered by optional `events` array. No OAuth app or bot token required.
- `telegram.ts` — Telegram interactive extension. Contributes: `kota telegram` CLI command (interactive bot), `telegram-status` channel (daemon status poll responding to `/status`), and notification subscriptions for all workflow events including `approval.requested`. Requires `extensions.telegram.botToken` and `chatId`.
- `github/index.ts` — GitHub REST API tools: `github_create_pr`, `github_get_pr`, `github_list_issues`, `github_comment`, `github_merge_pr`. Requires `extensions.github.token`. Mutating tools are classified as dangerous in guardrails. Supports `$ENV_VAR` token references and falls back to `git remote` for repo resolution.
- `github-webhook/index.ts` — GitHub webhook receiver. Registers `POST /api/webhooks/github`, validates `X-Hub-Signature-256` HMAC using `node:crypto`, and emits `github.push`, `github.pull_request`, or `github.check_run` bus events. Requires `extensions.github-webhook.secret`. Route is not registered when secret is missing.
