# Web Module

This directory owns the `web` repo module — HTTP API server with SSE streaming and embedded web UI.

- Registers `kota serve` CLI command. The action handler routes through
  `ctx.client.web.start(opts)`. The local handler in `web-operations.ts`
  starts the HTTP server in-process. The daemon-side handler returns
  `{ ok: false, reason: "daemon_required" }` because the daemon cannot
  start a fresh `kota serve` process in another address space; the CLI
  maps that to a "stop the daemon first" hint.
- Actual server logic lives in `src/core/server/server.ts`; this module wires it into the CLI and collects module routes.
- Web sessions use configured autonomy explicitly. Missing session-autonomy
  config is a startup error, not a hidden fallback.
