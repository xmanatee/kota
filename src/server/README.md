# Server Subsystem

HTTP API server with session management and real-time notifications.

## Files

| File | Purpose |
|------|---------|
| `server.ts` | `startServer()` — HTTP server with REST endpoints and extension route integration |
| `session-pool.ts` | `SessionPool` — manages concurrent agent sessions, SSE transport, CORS |
| `server-notifications.ts` | `NotificationHub` — SSE push notifications for scheduled action results |
| `server-routes.ts` | Thin orchestrator — `ServerContext`, `readDaemonState`, route dispatch |
| `session-routes.ts` | Session CRUD and chat handlers |
| `history-routes.ts` | History list/get/delete handlers |
| `approval-routes.ts` | Approval list/approve/reject handlers |
| `workflow-routes.ts` | Workflow run and status handlers |
| `task-routes.ts` | Task status handlers |

## Dependencies

- `server.ts` ← `session-pool.ts`, `server-notifications.ts`, `../scheduler/*`, `../memory/*`, `../loop.ts`
- `server-routes.ts` ← all `*-routes.ts` files, `session-pool.ts`
- `session-pool.ts` ← `../transport.ts`, `../loop.ts`
- `server-notifications.ts` ← `session-pool.ts`, `../scheduler/*`
