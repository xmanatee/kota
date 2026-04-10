# Server Subsystem

HTTP API server with session management and real-time notifications.

## Files

| File | Purpose |
|------|---------|
| `server.ts` | `startServer()` — HTTP server with REST endpoints and module route integration |
| `session-pool.ts` | `SessionPool` — manages concurrent agent sessions, SSE transport, CORS |
| `server-notifications.ts` | `NotificationHub` — SSE push notifications for scheduled action results |
| `server-routes.ts` | Thin orchestrator — `ServerContext`, route dispatch, supports module-contributed routes (including parameterized paths via `pathPattern`) |
| `session-routes.ts` | Session CRUD and chat handlers |
| `daemon-routes.ts` | `queryDaemonStatus` — reads live daemon status via `DaemonControlClient` |
| `daemon-client.ts` | `DaemonControlClient` — queries the running daemon's loopback HTTP control API |
| `event-routes.ts` | `handleEventTrigger` — emits a named event onto the bus |

## Module-Contributed Routes

Capability-specific routes are contributed by their owning modules via `KotaModule.routes`:

| Module | Routes | Location |
|--------|--------|----------|
| `workflow` | `/api/workflow/*`, `/api/workflow/runs/*` | `src/modules/workflow-ops/routes.ts` |
| `memory` | `/api/memory`, `/api/memory/:id` | `src/modules/memory/routes.ts` |
| `knowledge` | `/api/knowledge`, `/api/knowledge/:id` | `src/modules/knowledge/routes.ts` |
| `history` | `/api/history`, `/api/history/:conversationId` | `src/modules/history/routes.ts` |
| `approval-queue` | `/api/approvals`, `/api/approvals/:id/approve`, `/api/approvals/:id/reject` | `src/modules/approval-queue/routes.ts` |
| `repo-tasks` | `/api/tasks`, `/api/tasks/:id/state`, `/api/tasks/:id/body` | `src/modules/repo-tasks/routes.ts` |
| `guardrails-audit` | `/api/audit` | `src/modules/guardrails-audit/routes.ts` |
| `config` | `/api/config` | `src/modules/config/routes.ts` |
| `module-manager` | `/api/modules` | `src/modules/module-manager/routes.ts` (inline) |

## Proxy Pattern

The `history`, `approval-queue`, and `repo-tasks` route handlers accept an optional `DaemonControlClient`. When the client is present (daemon is running), they proxy the request through the daemon's control API and return. When `null`, they run in standalone server mode and read local state directly.

Tests for these handlers must cover **both paths**: the proxy path (mock client returning data) and the standalone path (null client, direct reads).

## Dependencies

- `server.ts` ← `session-pool.ts`, `server-notifications.ts`, `../core/daemon/*`, `../memory/*`, `../core/loop/loop.ts`
- `server-routes.ts` ← `session-routes.ts`, `daemon-routes.ts`, `event-routes.ts`, `session-pool.ts`, `daemon-client.ts`
- `session-pool.ts` ← `../core/loop/transport.ts`, `../core/loop/loop.ts`
- `server-notifications.ts` ← `session-pool.ts`, `../core/daemon/*`
- `daemon-client.ts` ← `../core/daemon/daemon-control.ts` (types)
