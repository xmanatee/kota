# Tool Cache Extension

This directory owns the `tool-cache` built-in extension — caching middleware for deterministic read tools.

- Registers cache middleware at priority 10 (early, before logging/audit).
- Caches idempotent read tool results and invalidates on mutating tool runs.
- Session-scoped: cache resets when the extension unloads.
- Middleware implementation lives in `src/tool-cache.ts`.

## Files

- `index.ts` — `KotaExtension` definition; registers and unregisters the cache middleware.
