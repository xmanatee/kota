# Tool Retry Extension

This directory owns the `tool-retry` built-in extension — retry middleware for transient tool failures.

- Registers retry middleware at priority 20 (after cache at 10, before custom middleware at 100+).
- Auto-retries network tools on transient errors and shell commands on timeout with doubled timeout.
- Session-scoped: retry stats reset on unload.
- Middleware implementation lives in `src/tool-retry.ts`.

## Files

- `index.ts` — `KotaExtension` definition; registers and unregisters the retry middleware.
- `index.test.ts` — unit tests for retry middleware registration and behavior.
