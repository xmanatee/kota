import type { EventJournal } from "#core/events/event-journal.js";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { DaemonChatConversationResolver } from "./daemon-chat-handlers.js";
import type {
  DaemonChatMakeAgent,
  DaemonChatPoolOptions,
} from "./daemon-chat-pool.js";

export type DaemonControlServerOptions = {
  /** Maximum number of events retained in the in-memory ring buffer. Default: 500. */
  eventBufferSize?: number;
  /** Durable event journal used by /api/events; the SSE stream still uses the ring buffer. */
  eventJournal?: EventJournal;
  /**
   * When provided, enables POST /sessions, POST /sessions/:id/chat for daemon-owned sessions.
   * The factory receives the proxy transport, the session's autonomy mode, and
   * the conversation id the new AgentSession should resume from, plus the
   * configured project id the session must bind to.
   */
  makeAgent?: DaemonChatMakeAgent;
  /** Autonomy mode used when POST /sessions does not specify one. */
  defaultAutonomyMode?: AutonomyMode;
  /** Options forwarded to the daemon chat session pool. */
  chatPool?: DaemonChatPoolOptions;
  /**
   * Persisted session_id -> conversationId binding. Required whenever
   * DaemonControlServerOptions.makeAgent is supplied so daemon chat sessions
   * survive a restart with a client-facing wake path.
   */
  chatBindings?: DaemonChatBindingStore;
  /**
   * Resolves / creates conversation ids for new and woken chat sessions.
   * Required whenever DaemonControlServerOptions.makeAgent is supplied.
   */
  conversationResolver?: DaemonChatConversationResolver;
  /**
   * Module-contributed daemon-control routes. Each contribution carries its
   * own capability scope; the router applies the same bearer-token and
   * scope check to contributed routes as to built-in ones. Paths colliding
   * with a built-in route or with another contribution throw at startup.
   */
  controlRoutes?: readonly ControlRouteRegistration[];
  /**
   * Module-contributed HTTP routes (the same KotaModule.routes list that
   * kota serve consumes). The daemon's control server registers them as a
   * fallthrough after built-in routes and contributed control routes do not
   * match, so a running daemon serves the same /api/* surface those modules
   * publish to kota serve. Bearer-token auth applies unless the route opts
   * out via bypassAuth. Path collisions with a built-in or contributed
   * control route throw at startup.
   */
  routes?: readonly RouteRegistration[];
};
