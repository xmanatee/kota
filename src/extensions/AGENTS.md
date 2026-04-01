# Extensions

This directory contains built-in extensions and extension-level wiring.

- Keep built-in extensions isolated behind extension contracts rather than reaching into core internals ad hoc.
- If extension boundaries drift, fix the boundary instead of normalizing the drift.

## Shared Utilities

- `notify-retry.ts` — `postWithRetry`: shared HTTP POST helper with exponential-backoff retry used by the webhook and Slack extensions. Accepts `retries` and `baseDelayMs` options; logs a warning after all attempts are exhausted.
