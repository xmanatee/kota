# Tool Cache Module

This directory owns the `tool-cache` repo module — caching middleware for deterministic read tools.

- Registers cache middleware at priority 10 (early, before logging/audit).
- Caches idempotent read tool results and invalidates on mutating tool runs.
- Session-scoped: cache resets when the module unloads.
- Middleware implementation lives in `src/tool-cache.ts`.

## Files

- `index.ts` — `KotaModule` definition; registers and unregisters the cache middleware.
