/**
 * Server subsystem — HTTP API server and session pool management.
 */

export { type ServerOptions, startServer } from "./server.js";
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
