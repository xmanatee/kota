/**
 * Channel — optional interactive surfaces that map external I/O to sessions.
 *
 * A channel is a module surface for external users. CLI, autonomous
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
 *
 * ## Channel Contributions
 *
 * Modules contribute channels via `KotaModule.channels`. The daemon
 * collects contributed channels at startup and manages their lifecycle.
 * Each `ChannelDef` is a named descriptor plus a factory. The factory receives
 * a `ChannelStartContext` from the daemon and returns a `ChannelAdapter`, or
 * null if the channel cannot start (e.g., missing credentials).
 */

import type { AgentSession } from "../loop/loop.js";
import type { ProxyTransport } from "../loop/transport.js";
import type { WorkflowRuntimeState } from "../workflow/run-types.js";

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

/**
 * Runtime workflow status exposed to channels that need to monitor or
 * report on the daemon's execution state (e.g., Telegram status poll).
 */
export type ChannelWorkflowStatus = {
  runtimeState: WorkflowRuntimeState;
  dispatchPaused: boolean;
  runsDir: string;
};

/**
 * Context provided to a channel factory when the daemon starts it.
 */
export type ChannelStartContext = {
  /** Project root directory. */
  projectDir: string;
  /** Logger for channel messages. */
  log: (message: string) => void;
  /** Current workflow runtime status for monitoring/alerting channels. */
  getWorkflowStatus: () => ChannelWorkflowStatus;
};

/**
 * ChannelDef — descriptor for a channel contributed by a module.
 *
 * Modules declare channels in `KotaModule.channels`. The daemon
 * collects them at startup, calls `create()` for each one, and manages
 * their lifecycle alongside workflows and stores.
 */
export type ChannelDef = {
  /** Unique identifier for this channel (e.g., "telegram-status"). */
  name: string;
  /** Short description of what this channel does. */
  description?: string;
  /**
   * Creates the ChannelAdapter that manages this channel's lifecycle.
   * Return null if the channel cannot start (missing credentials, disabled
   * config, etc.) — the daemon skips null channels silently.
   */
  create(ctx: ChannelStartContext): ChannelAdapter | null;
};
