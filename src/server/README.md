# Server Subsystem

HTTP API server with session management and real-time notifications.

## Files

| File | Purpose |
|------|---------|
| `server.ts` | `startServer()` — HTTP server with REST endpoints and extension route integration |
| `session-pool.ts` | `SessionPool` — manages concurrent agent sessions, SSE transport, CORS |
| `server-notifications.ts` | `NotificationHub` — SSE push notifications for scheduled action results |
| `server-routes.ts` | Thin orchestrator — `ServerContext`, route dispatch, passes `DaemonControlClient` to proxy-capable handlers |
| `session-routes.ts` | Session CRUD and chat handlers |
| `history-routes.ts` | History list/get/delete handlers (proxy-capable) |
| `approval-routes.ts` | Approval list/approve/reject handlers (proxy-capable) |
| `task-routes.ts` | Task status handlers (proxy-capable) |
| `workflow-routes.ts` | Workflow run and status handlers |
| `workflow-run-routes.ts` | Workflow run detail and log streaming handlers |
| `daemon-routes.ts` | `queryDaemonStatus` — reads live daemon status via `DaemonControlClient` |
| `daemon-client.ts` | `DaemonControlClient` — queries the running daemon's loopback HTTP control API |
| `event-routes.ts` | `handleEventTrigger` — emits a named event onto the bus |
| `extension-routes.ts` | `handleListExtensions` — returns loaded extension metadata for `GET /api/extensions` |

## Proxy Pattern

`history-routes.ts`, `approval-routes.ts`, and `task-routes.ts` accept an optional `DaemonControlClient` as a parameter. When the client is present (daemon is running), they proxy the request through the daemon's control API and return. When `null`, they fall back to direct file reads.

`server-routes.ts` passes `DaemonControlClient.fromStateDir()` to all three. Tests for these handlers must cover **both paths**: the proxy path (mock client returning data) and the fallback path (null client, direct reads).

## Dependencies

- `server.ts` ← `session-pool.ts`, `server-notifications.ts`, `../scheduler/*`, `../memory/*`, `../loop.ts`
- `server-routes.ts` ← all `*-routes.ts` files, `session-pool.ts`, `daemon-client.ts`
- `session-pool.ts` ← `../transport.ts`, `../loop.ts`
- `server-notifications.ts` ← `session-pool.ts`, `../scheduler/*`
- `daemon-client.ts` ← `../scheduler/daemon-control.ts` (types)
