# Server

This directory contains the HTTP server, session pool, server-side notifications, and route handlers.

- Route handlers are split into focused files by concern. See `README.md` for the current file inventory. `server-routes.ts` is the thin orchestrator that registers them all.
- `daemon-client.ts` — `DaemonControlClient`; queries the running daemon's loopback HTTP control API. Used by route handlers to get live daemon and workflow state instead of reading `.kota/` files directly.
- When adding new routes for a capability owned by a module, prefer contributing routes via `KotaModule.routes` in the owning module instead of adding a new `*-routes.ts` file here. `server-routes.ts` dispatches module-contributed routes via the `moduleRoutes` array.
- **Server-core routes** (stay in `src/server/`): `session-routes.ts`, `workflow-routes.ts`, `workflow-run-routes.ts`, `daemon-routes.ts`, `event-routes.ts`, `history-routes.ts`, `approval-routes.ts`, `task-routes.ts`. The latter three use `DaemonControlClient` for daemon proxying — moving them to owning modules would create a circular dependency (`src/modules/` → `src/server/daemon-client.ts` ← `src/scheduler/`).
- **Migration targets** (should move to owning modules): `memory-routes.ts` → `memory` module, `knowledge-routes.ts` → `knowledge` module. These are pure capability CRUD with no proxy dependency. The `listServerRouteMigrationDebt` check in `task-queue-validation.ts` enforces a ready architecture task while they remain here.
- New `*-routes.ts` files for server-core concerns should have a co-located `*-routes.test.ts`.
- Route handlers that proxy through the daemon accept an optional `DaemonControlClient` parameter (`history-routes.ts`, `approval-routes.ts`, `task-routes.ts`). When the client is non-null, they proxy and return; when null, they run in standalone server mode and read local state directly. Tests for these handlers must cover **both** paths.
- Keep transport/session concerns here.
- `session-pool.ts` — `SessionPool` and `SseTransport`; used by `kota serve` for its own interactive sessions. The daemon also owns a separate session pool (via `DaemonChatPool` in `src/scheduler/daemon-control-chat.ts`) for daemon-owned sessions created through the daemon control API. The two pools are independent — do not import from `src/server/` in `src/scheduler/` as `server/daemon-client.ts` already imports from `scheduler/`, and a reverse import would create a circular dependency.
