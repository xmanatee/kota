/**
 * Server subsystem — HTTP API server, session pool management,
 * and SSE notification hub.
 */

export { type ServerOptions, startServer } from "./server.js";
export { NotificationHub } from "./server-notifications.js";
export {
	CORS_HEADERS,
	jsonResponse,
	type ManagedSession,
	readBody,
	SessionPool,
	type SessionPoolOptions,
	SseTransport,
	setCors,
} from "./session-pool.js";
