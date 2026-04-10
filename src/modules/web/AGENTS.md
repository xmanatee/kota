# Web Module

This directory owns the `web` repo module — HTTP API server with SSE streaming and embedded web UI.

- Registers `kota serve` CLI command.
- Actual server logic lives in `src/core/server/server.ts`; this module wires it into the CLI and collects module routes.

## Files

- `index.ts` — `KotaModule` definition; `kota serve` CLI command.
- `index.test.ts` — unit tests for serve command registration.
