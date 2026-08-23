/**
 * KotaModule protocol — the standard unit of functionality in KOTA.
 *
 * A module can register tools, CLI commands, HTTP routes, and event
 * subscriptions. Project and third-party modules use the same
 * protocol.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { AgentDef, SkillDef } from "#core/agents/agent-types.js";
import type { CapabilityScope } from "#core/daemon/daemon-control-types.js";
import type { ProjectId } from "#core/daemon/scope-registry.js";
import type { BusEnvelope, BusEvents } from "#core/events/event-bus-types.js";
import type {
  ModuleEventDef,
  ModuleEventPayload,
} from "#core/events/module-event.js";
import type { Transport } from "#core/loop/transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { ToolEffect } from "#core/tools/effect.js";
import type { ToolRunner } from "#core/tools/index.js";
import type { ToolEffectResolver } from "#core/tools/tool-effect-registry.js";
import type { ModuleCapabilityManifestProjection } from "./module-manifest.js";
import type { ModuleSetupRequirement } from "./setup-requirements.js";

/** Health state for a foreign (KEMP) module subprocess. */
export type ModuleHealth = {
  status: "ok" | "restarting" | "dead";
  restartCount: number;
  lastRestartAt?: string;
};

/** Result of an optional module-level runtime health check. */
export type HealthCheckResult = {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
};

/** Discovery source of a module. */
export type ModuleSource = "project" | "installed" | "foreign";

/** JSON-shaped input accepted only at module protocol boundaries. */
export type ModuleBoundaryRecord = Record<string, unknown>;

/** Summary of a loaded module's metadata and contributions. */
export type ModuleSummary = {
  name: string;
  source: ModuleSource;
  version?: string;
  description?: string;
  dependencies: string[];
  toolNames: string[];
  workflowNames: string[];
  channelNames: string[];
  skillNames: string[];
  agentNames: string[];
  agents: AgentDef[];
  skills: SkillDef[];
  setupRequirements?: readonly ModuleSetupRequirement[];
  commandNames: string[];
  routeSummaries: string[];
  commandError?: string;
  routeError?: string;
  health?: ModuleHealth;
  /** Result of the module's optional runtime health check. */
  healthCheck?: HealthCheckResult;
  /** Machine-readable capability/effect manifest derived from module declarations. */
  manifest?: ModuleCapabilityManifestProjection;
  /** Set when the module failed to load; absent for successfully loaded modules. */
  loadError?: string;
};

/** Scoped logger available to modules via ModuleContext. */
export type ModuleLogger = {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  debug: (msg: string, data?: unknown) => void;
};

/**
 * Event proxy available to modules via `ModuleContext`.
 *
 * The normal module path is typed: `emit` and `subscribe` accept either a
 * core-typed `BusEvents` key or a `ModuleEventDef` declaration imported from
 * the module that owns the event. The wildcard form receives a typed
 * `BusEnvelope` for tracing and metrics.
 *
 * Truly external events (inbound webhook surfaces forwarding arbitrary
 * remote event names, dynamic third-party event ids) use the visibly-unsafe
 * `emitExternal` / `subscribeExternal` escape hatches and must validate at
 * the boundary.
 */
export type ModuleEventProxy = {
  /** Emit a core-typed `BusEvents` event. */
  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void;
  /** Emit a module-declared typed event using its `ModuleEventDef`. */
  emit<E extends ModuleEventDef>(event: E, payload: ModuleEventPayload<E>): void;
  /** Subscribe to a core-typed `BusEvents` event. */
  subscribe<K extends keyof BusEvents>(
    event: K,
    handler: (payload: BusEvents[K]) => void,
  ): () => void;
  /** Subscribe to a module-declared typed event using its `ModuleEventDef`. */
  subscribe<E extends ModuleEventDef>(
    event: E,
    handler: (payload: ModuleEventPayload<E>) => void,
  ): () => void;
  /** Wildcard subscriber for tracing/metrics. Receives typed `BusEnvelope`s. */
  subscribe(
    event: "*",
    handler: (envelope: BusEnvelope) => void,
  ): () => void;
  /**
   * Visibly-unsafe escape hatch for events whose name and payload only become
   * known at runtime (inbound webhook bridges, dynamic third-party event
   * ids). Callers must validate the payload before forwarding it as a typed
   * event to the rest of the system.
   */
  emitExternal(event: string, payload: Record<string, unknown>): void;
  /**
   * Visibly-unsafe escape hatch for subscribing to events whose payload type
   * cannot be expressed in either `BusEvents` or a `ModuleEventDef`.
   */
  subscribeExternal(
    event: string,
    handler: (payload: Record<string, unknown>) => void,
  ): () => void;
  /**
   * Number of subscribers for the given event name (or all events if omitted).
   * Throws when no runtime EventBus is bound.
   */
  listenerCount(event?: string): number;
};

/** Minimal session interface returned by ctx.createSession(). */
export type ModuleSession = {
  /** Send a prompt and get the response text. */
  send(prompt: string): Promise<string>;
  /** Close the session and release resources. */
  close(): void;
};

/** Options for ctx.createSession(). */
export type CreateSessionOptions = {
  model?: string;
  label?: string;
  /** If true, conversation won't be saved to history. Default: true for module sessions. */
  noHistory?: boolean;
  /** Explicit posture for host-created sessions; child sessions otherwise inherit their parent. */
  autonomyMode?: AutonomyMode;
  /** Host scope for a session created outside an existing parent session. */
  projectId?: ProjectId;
  /** Optional module-owned response transport. */
  transport?: Transport;
  historySource?: "user" | "action";
  reflectionEnabled?: boolean;
};

/** A tool definition contributed by a module. */
export type ToolDef = {
  tool: KotaTool;
  runner: ToolRunner;
  /** Tool group for progressive disclosure. Ungrouped tools are always available. */
  group?: string;
  /**
   * First-class effect descriptor. Required: drives guardrail classification,
   * autonomy-mode posture, and MCP annotations. See `#core/tools/effect.js`.
   */
  effect: ToolEffect;
  /**
   * Invocation-specific effect escalation for multi-operation tools. The
   * static effect remains the conservative baseline and discovery/MCP
   * projection.
   */
  resolveEffect?: ToolEffectResolver;
};

export type ModuleRouteMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Handler signature for a module-contributed HTTP route. The router extracts
 * any `:name` / `*name` path params once before invoking the handler.
 */
export type ModuleRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void | Promise<void>;

/**
 * Shared shape for module-contributed HTTP routes. Both the public
 * `RouteRegistration` surface and the daemon-control `ControlRouteRegistration`
 * surface share this descriptor so path matching, param extraction, and auth
 * posture follow one rule. Surface-specific fields (e.g. capability scope on
 * the daemon-control surface) extend this base.
 *
 * Path grammar:
 * - literal segments match exactly (`/api/tasks`)
 * - `:name` captures a single decoded path segment (`/api/tasks/:id`)
 * - `*name` as the final segment captures the rest of the path including
 *   slashes (`/assets/*rest`)
 *
 * Method + path must not collide with another contribution; the daemon-control
 * server rejects exact-key collisions loudly at startup.
 */
export type ModuleRouteBase = {
  method: ModuleRouteMethod;
  path: string;
  /**
   * When true, the server skips the bearer-token auth check for this route.
   * Use for inbound webhook endpoints whose auth is carried in a per-request
   * signature header rather than the daemon's Bearer token (e.g. GitHub
   * webhooks, `POST /webhooks/:name`). The module must perform its own
   * request authentication.
   */
  bypassAuth?: boolean;
  /**
   * Optional protocol-shaped denial handler invoked when the host bearer-token
   * check fails for this matched route. This does not bypass authentication:
   * use it only to return a route-native error envelope without doing
   * privileged work.
   */
  authFailureHandler?: ModuleRouteHandler;
  handler: ModuleRouteHandler;
};

/** An HTTP route registered by a module on the public `kota serve` surface. */
export type RouteRegistration = ModuleRouteBase;

/**
 * An HTTP route registered by a module on the daemon-control server. The
 * daemon-control surface is capability-scoped: every request is classified
 * as a `read` or `control` call before the handler runs.
 */
export type ControlRouteRegistration = ModuleRouteBase & {
  /**
   * Capability scope required to invoke the route.
   * - "read": observe daemon state
   * - "control": mutate daemon state or trigger external side effects
   */
  capabilityScope: CapabilityScope;
};

export * from "./module-context-types.js";
export * from "./module-definition.js";
