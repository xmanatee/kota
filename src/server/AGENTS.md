# Server

This directory contains the HTTP server, session pool, server-side notifications, and route handlers.

- Route handlers are split into focused files by concern. See `README.md` for the current file inventory. `server-routes.ts` is the thin orchestrator that dispatches module-contributed routes.
- `daemon-client.ts` — `DaemonControlClient`; queries the running daemon's loopback HTTP control API. Used by route handlers to get live daemon and workflow state instead of reading `.kota/` files directly.
- When adding new routes for a capability owned by a module, contribute routes via `KotaModule.routes` in the owning module instead of adding a new `*-routes.ts` file here. `server-routes.ts` dispatches module-contributed routes via the `moduleRoutes` array and supports parameterized paths via `RouteRegistration.pathPattern`.
- **Server-core routes** (stay in `src/server/`): `session-routes.ts`, `daemon-routes.ts`, `event-routes.ts`. These are session/runtime infrastructure with no module ownership.
- **Capability routes** live in their owning modules: `workflow`, `memory`, `knowledge`, `history`, `approval-queue`, `repo-tasks` all contribute routes via `KotaModule.routes`. Proxy-capable handlers (history, approval-queue, repo-tasks) call `DaemonControlClient.fromStateDir()` inside the handler — this does not create a circular dependency since modules may import from `src/server/` utilities.
- New `*-routes.ts` files for server-core concerns should have a co-located `*-routes.test.ts`.
- Keep transport/session concerns here.
- `session-pool.ts` — `SessionPool` and `SseTransport`; used by `kota serve` for its own interactive sessions. The daemon also owns a separate session pool (via `DaemonChatPool` in `src/core/daemon/daemon-control-chat.ts`) for daemon-owned sessions created through the daemon control API. The two pools are independent — do not import from `src/server/` in `src/core/daemon/` as `server/daemon-client.ts` already imports from the daemon core, and a reverse import would create a circular dependency.
