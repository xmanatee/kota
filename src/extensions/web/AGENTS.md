# Web Extension

This directory owns the `web` built-in extension — HTTP API server with SSE streaming and embedded web UI.

- Registers `kota serve` CLI command.
- Actual server logic lives in `src/server/server.ts`; this extension wires it into the CLI and collects extension routes.

## Files

- `index.ts` — `KotaExtension` definition; `kota serve` CLI command.
- `index.test.ts` — unit tests for serve command registration.
