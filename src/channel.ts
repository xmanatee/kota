/**
 * Channel — optional interactive surfaces that map external I/O to sessions.
 *
 * A channel is an extension surface for external users. CLI, autonomous
 * workflow execution, and single-shot agent runs do NOT need a channel.
 * Channels are for persistent multi-user surfaces: web server, Telegram, etc.
 *
 * channel protocol: session routing, inbound/outbound transport, operator identity.
 *
 * ## Session vs Channel
 *
 * `session` is core — every agent run is a session, whether interactive or
 * autonomous. `AgentSession` owns the conversation, context, and tool execution.
 *
 * `channel` is optional — a channel manages a pool of sessions on behalf of
 * external users. Channels handle input routing, user identity, and lifecycle
 * (one session per chat/user). Autonomous workflows skip channels entirely.
 */

import type { AgentSession } from "./loop.js";
import type { ProxyTransport } from "./transport.js";

/**
 * A session managed by a channel adapter — one AgentSession per user/chat.
 *
 * Channels use ProxyTransport so the agent's output can be routed to
 * different sinks per request (e.g., different HTTP responses, Telegram messages).
 * Between requests the proxy points at NullTransport.
 *
 * Both the HTTP server (ManagedSession) and Telegram use this shape.
 */
export type ChannelSession = {
  agent: AgentSession;
  proxy: ProxyTransport;
  lastActive: number;
};

/**
 * ChannelAdapter — the interface an interactive channel surface implements.
 *
 * A channel starts accepting input when start() resolves and releases all
 * managed sessions when stop() is called.
 *
 * Both TelegramBot and the HTTP server conform to this interface.
 */
export type ChannelAdapter = {
  start(): Promise<void>;
  stop(): void | Promise<void>;
};
