# Server

This directory contains the HTTP server, session pool, server-side notifications, and route handlers.

- Route handlers are split into focused files by concern: `session-routes.ts`, `history-routes.ts`, `approval-routes.ts`, `workflow-routes.ts`, `workflow-run-routes.ts`, `task-routes.ts`, `daemon-routes.ts`, `event-routes.ts`, `knowledge-routes.ts`. `server-routes.ts` is the thin orchestrator that registers them all.
- `daemon-client.ts` — `DaemonControlClient`; queries the running daemon's loopback HTTP control API. Used by route handlers to get live daemon and workflow state instead of reading `.kota/` files directly.
- When adding new routes, follow the pattern: create a focused `*-routes.ts` file and register it in `server-routes.ts`.
- Route handlers that proxy through the daemon accept an optional `DaemonControlClient` parameter (`history-routes.ts`, `approval-routes.ts`, `task-routes.ts`). When the client is non-null, they proxy and return; when null, they fall back to direct reads. Tests for these handlers must cover **both** the proxy path and the fallback path.
- Keep transport/session concerns here.
- Update the local `README.md` when the server surface changes materially (new files, removed files, or changed responsibilities).
