# Server Subsystem

HTTP API server with session management and real-time notifications.

## Files

| File | Purpose |
|------|---------|
| `server.ts` | `startServer()` — HTTP server with REST endpoints, module route integration |
| `session-pool.ts` | `SessionPool` — manages concurrent agent sessions, SSE transport, CORS |
| `server-notifications.ts` | `NotificationHub` — SSE push notifications for scheduled action results |

## Dependencies

- `server.ts` ← `session-pool.ts`, `server-notifications.ts`, `../scheduler/*`, `../memory/*`, `../loop.ts`
- `session-pool.ts` ← `../transport.ts`, `../loop.ts`
- `server-notifications.ts` ← `session-pool.ts`, `../scheduler/*`
