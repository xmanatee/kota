/**
 * KotaModule protocol — the standard unit of functionality in KOTA.
 *
 * A module can register tools, CLI commands, HTTP routes, and event
 * subscriptions. Project and third-party modules use the same
 * protocol.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Command } from "commander";
import type { PostRunHook, PreRunHook } from "#core/agent-harness/hooks.js";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { AgentDef, SkillDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ModuleConfigSlice } from "#core/config/config-slice.js";
import type { CapabilityScope } from "#core/daemon/daemon-control-types.js";
import type { BusEnvelope, BusEvents } from "#core/events/event-bus-types.js";
import type {
  ModuleEventDef,
  ModuleEventPayload,
} from "#core/events/module-event.js";
import type { DynamicStateContext } from "#core/loop/dynamic-state.js";
import type { PreSendHook } from "#core/loop/pre-send-hooks.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  DaemonClientHandlers,
  KotaClient,
  LocalClientHandlers,
} from "#core/server/kota-client.js";
import type { ToolEffect } from "#core/tools/effect.js";
import type { ToolRunner } from "#core/tools/index.js";
import type { ToolMiddlewareFn } from "#core/tools/tool-middleware.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinitionInput } from "#core/workflow/types.js";
import type { ModuleStorage } from "./module-storage.js";
import type { ProviderToken } from "./provider-token.js";

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
  commandNames: string[];
  routeSummaries: string[];
  commandError?: string;
  routeError?: string;
  health?: ModuleHealth;
  /** Result of the module's optional runtime health check. */
  healthCheck?: HealthCheckResult;
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
   * Number of subscribers for the given event name (or all events if
   * omitted). Returns 0 if the bus is not available.
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

export type ModuleContribution<T> =
  | readonly T[]
  | ((ctx: ModuleContext) => readonly T[] | Promise<readonly T[]>);

export type ModuleWorkflowContribution =
  | WorkflowDefinitionInput
  | RegisteredWorkflowDefinitionInput;

/**
 * Static metadata available to every module hook.
 *
 * `cwd`, `config`, `storage`, scoped `log`, `getSecret`, and the module's own
 * config slice. No invocation, no registration — just the surrounding world.
 */
export type ModuleBaseContext = {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  /** Scoped file-based storage for this module (`.kota/modules/<name>/`). */
  storage: ModuleStorage;
  /** Scoped logger — messages prefixed with `[module:<name>]`. */
  log: ModuleLogger;
  /** Get a secret value by name. Returns null if not found or store not initialized. */
  getSecret: (key: string) => string | null;
  /** Get this module's config section from the KOTA config. */
  getModuleConfig: <T = Record<string, unknown>>() => T | undefined;
  /** Top-level config keys registered by loaded modules. */
  getRegisteredConfigKeys: () => ReadonlySet<string>;
};

/**
 * Read-only inspection of the module landscape.
 *
 * Module hooks call these accessors to discover what other modules have
 * contributed. They never mutate runtime state.
 */
export type ModuleInspectionContext = {
  /** Get HTTP routes registered by all loaded modules. */
  getRoutes: () => RouteRegistration[];
  /** Get daemon-control HTTP routes contributed by all loaded modules. */
  getContributedControlRoutes: () => ControlRouteRegistration[];
  /** Get workflow definitions contributed by loaded modules. */
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  /** Get channel definitions contributed by loaded modules. */
  getContributedChannels: () => ChannelDef[];
  /** Get summaries of all loaded modules (name, version, contribution counts). */
  getModuleSummaries: () => ModuleSummary[];
  /** Look up a registered agent definition by name. */
  resolveAgentDef: (name: string) => AgentDef | undefined;
  /** Build the skills prompt for a set of skill names or "all", optionally filtered by agent name. */
  resolveSkillsPrompt: (skillNames: string[] | "all", agentName?: string) => string;
  /** Probe all modules that declare a healthCheck and return results. */
  probeHealthChecks: () => Promise<Record<string, HealthCheckResult>>;
};

/** Tool invocation surface — call other modules' tools at request time. */
export type ToolInvocationContext = {
  /** Invoke a registered tool directly without going through the LLM. Skips guardrails. */
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  /** List names of all currently registered tools. */
  listTools: () => string[];
};

/** Typed event emit/subscribe through the module event proxy. */
export type ModuleEventContext = {
  /** Event proxy for emitting and subscribing to bus events. */
  events: ModuleEventProxy;
};

/** Read-side typed provider lookup. Available everywhere providers are observed. */
export type ProviderLookupContext = {
  /** Get the active provider for a typed token. Returns null if none registered. */
  getProvider: <T>(token: ProviderToken<T>) => T | null;
};

/** Per-call session creation. Available for command/route handlers via closure. */
export type ModuleSessionContext = {
  /** Create an agent session without importing core types. */
  createSession: (options?: CreateSessionOptions) => ModuleSession;
};

/** Local-side `KotaClient` access for CLI subcommand handlers. */
export type ModuleClientContext = {
  /**
   * The resolved KotaClient for the current CLI invocation. Subcommands
   * read this to talk to KOTA capabilities — workflows, approvals, secrets,
   * tasks, memory — without deciding "daemon vs local" themselves. The
   * CLI startup runs the selector once before commands execute; throws
   * loudly if accessed before resolution.
   */
  readonly client: KotaClient;
};

/**
 * Provider registration capability — load-time only.
 *
 * Available to `onLoad` so a module can announce itself as the implementation
 * for a typed provider token. Excluded from contribution hooks because
 * registration outside the lifecycle boundary is meaningless: the registry is
 * already wired up and providers may already have been activated.
 */
export type ProviderRegistrationContext = {
  /**
   * Register this module as a provider for the given typed token. The
   * token's value type is enforced at the call site, so a wrong-shape
   * provider fails typecheck instead of being detected at runtime.
   */
  registerProvider: <T>(token: ProviderToken<T>, provider: T) => void;
};

/** Tool registration capability — load-time only. */
export type ToolRegistrationContext = {
  /** Register a custom tool group with optional auto-detect regex. */
  registerGroup: (name: string, toolNames: string[], pattern?: RegExp) => void;
  /** Register a middleware that wraps tool execution. Lower priority runs first. */
  registerMiddleware: (name: string, fn: ToolMiddlewareFn, priority?: number) => void;
};

/** Loop and harness decoration hooks — load-time only. */
export type LoopDecorationContext = {
  /**
   * Register a per-turn dynamic system-prompt state provider.
   * The function is called synchronously on every agent turn with the
   * effective tool set for the turn, and its output is appended to the
   * dynamic system-prompt block.
   */
  registerDynamicStateProvider: (
    name: string,
    fn: (ctx: DynamicStateContext) => string,
  ) => void;
  /** Register synchronous cleanup that should run before a session closes. */
  registerCleanupHook: (fn: () => void) => void;
  /**
   * Register a per-send hook that runs once before the main agent iteration
   * loop starts. Use this to contribute a planning/execution pass that
   * precedes the normal agent turn (e.g. architect-mode two-pass flow).
   * Each hook receives the session context and may return a result that the
   * loop applies (modified files, assistant text, user follow-up, final text).
   *
   * Note: this hook is classic-loop-specific — its context exposes the
   * `AgentSession` ModelClient, message history, cost tracker, and transport.
   * To run code at the harness boundary of every adapter (claude-agent-sdk,
   * thin, or any future adapter), use `registerHarnessHook` instead.
   */
  registerPreSendHook: (name: string, fn: PreSendHook) => void;
  /**
   * Register a harness-neutral lifecycle hook. `preRun` fires before every
   * `AgentHarness.run()` invocation; `postRun` fires after it returns. The
   * neutral entry point validates the chosen adapter's `supportedHookKinds`
   * and throws loudly if a registered hook targets a kind the adapter does
   * not host, matching the rejection pattern for tool options in
   * `thin-agent-harness`.
   */
  registerHarnessHook: (
    registration:
      | { kind: "preRun"; name: string; handler: PreRunHook }
      | { kind: "postRun"; name: string; handler: PostRunHook },
  ) => void;
};

/**
 * Contribution context — the surface available to module hooks that declare
 * static contributions or build closures whose handlers run at request time:
 * `tools`, `commands`, `routes`, `controlRoutes`, `localClient`, plus the
 * `workflows` / `channels` / `skills` / `agents` factories.
 *
 * Excludes lifecycle registration. A module that needs to register a provider,
 * a tool middleware, or a loop/harness hook must do so from `onLoad`, where
 * `ModuleRuntimeContext` exposes the registration capabilities.
 */
export type ModuleContext =
  & ModuleBaseContext
  & ModuleInspectionContext
  & ToolInvocationContext
  & ModuleEventContext
  & ProviderLookupContext
  & ModuleSessionContext
  & ModuleClientContext;

/**
 * Runtime context — the surface available during `onLoad`.
 *
 * Extends `ModuleContext` with the registration capabilities that mutate
 * load-time runtime state: provider registration, tool middleware/groups,
 * and the loop/harness decoration hooks.
 */
export type ModuleRuntimeContext =
  & ModuleContext
  & ProviderRegistrationContext
  & ToolRegistrationContext
  & LoopDecorationContext;

/**
 * KotaModule — the pluggable unit of KOTA functionality.
 *
 * Modules extend KOTA's capabilities through a declarative protocol:
 * - `tools` — register agent tools
 * - `commands` — add CLI subcommands (appear in `kota --help`)
 * - `routes` — add HTTP endpoints (available when server runs)
 * - `workflows` — contribute automation (event, cron, interval, idle)
 *
 * Project modules use the same protocol as user-installed ones.
 * The core without any modules loaded still functions as a basic agent.
 */
export type KotaModule = {
  /** Unique module identifier (e.g. "memory", "telegram", "web"). */
  name: string;
  /** Semver version string. */
  version?: string;
  /** Short description of what this module does. */
  description?: string;
  /** Names of modules that must be loaded before this one. */
  dependencies?: string[];

  /**
   * Top-level config slices this module owns. Each slice carries the
   * key, a description used by `kota config validate`, and typed
   * sanitize/merge callbacks. Slices are registered globally so
   * `loadConfig()` can apply them whether the module was discovered via
   * `discoverProjectModules()`/`discoverModules()` or loaded directly
   * through `ModuleLoader.load()`.
   */
  configSlices?: readonly ModuleConfigSlice[];

  /** JSON Schema fragment for this module's config under `config.modules`. */
  configSchema?: Record<string, unknown>;

  /**
   * Typed event declarations contributed by this module. Each declaration
   * names a module-owned event and the payload field set; cross-module
   * subscribers import the declaration to get a typed handler. The loader
   * registers contributions on load and unregisters them on unload, and
   * workflow trigger validation rejects filters that reference unknown
   * fields against these declarations.
   */
  events?: ReadonlyArray<ModuleEventDef>;

  /**
   * Tools this module provides. Registered during load.
   * Can be a static array or a factory that receives ModuleContext,
   * allowing tool runners to access module services via closure.
   */
  tools?: ToolDef[] | ((ctx: ModuleContext) => ToolDef[]);

  /**
   * CLI commands this module adds. Called once at load time.
   * Returned commands are added to the main program — they appear in `kota --help`.
   */
  commands?: (ctx: ModuleContext) => Command[];

  /**
   * HTTP routes this module adds. Called when the server starts.
   * Routes are matched by method + path in the HTTP request handler.
   */
  routes?: (ctx: ModuleContext) => RouteRegistration[];

  /**
   * Daemon-control HTTP routes this module adds. Called once at module
   * load time. Each route carries its required capability scope; the
   * daemon-control server applies the same `read` / `control` gate to
   * contributed routes as it does to built-in ones.
   */
  controlRoutes?: (ctx: ModuleContext) => ControlRouteRegistration[];

  /**
   * Workflow definitions this module contributes.
   * Contributed workflows are registered alongside other contributed workflows and support
   * the same trigger types: event, cron schedule, interval, and runtime.idle.
   * Use workflows to express hook-like reactions, heartbeat jobs, and scheduled
   * automation instead of subscribing to the event bus directly.
   */
  workflows?: ModuleContribution<ModuleWorkflowContribution>;

  /**
   * Channel definitions this module contributes.
   * Channels are daemon-owned interaction surfaces that map external I/O to sessions.
   * The daemon starts contributed channels at startup and stops them on shutdown.
   * A channel returns null from its factory if it cannot start (missing credentials).
   */
  channels?: ModuleContribution<ChannelDef>;

  /**
   * Skills this module contributes — named, file-backed guidance blocks.
   * Skills are the one way to teach the agent about module capabilities.
   */
  skills?: ModuleContribution<SkillDef>;

  /**
   * Agent definitions this module contributes.
   * Registered agents can be referenced by name in workflow agent steps.
   */
  agents?: ModuleContribution<AgentDef>;

  /**
   * Local-side handlers for the KotaClient namespaces this module owns.
   * The loader always invokes this factory at module load — including on
   * the CLI's `"commands"` lifecycle path — so the selector can assemble
   * a complete `LocalKotaClient` before any subcommand runs. Heavy
   * initialization (event subscriptions, channel startup, provider
   * registration) belongs in `onLoad`; this hook should stay light and
   * idempotent.
   */
  localClient?: (ctx: ModuleContext) => Partial<LocalClientHandlers>;

  /**
   * Daemon-side handlers for the KotaClient namespaces this module owns.
   * Symmetric to `localClient(ctx)`. Invoked by the selector with the
   * resolved `DaemonTransport` when the daemon is reachable, so the
   * factory can wire HTTP-backed namespace impls without depending on
   * `DaemonControlClient`. The loader registers these factories during
   * module load; the selector assembles them on top of a core-side stub
   * holding closures for the namespaces that have not yet migrated to
   * their owning module. A namespace contributed by a module overrides
   * the stub. Missing handlers (no contributor and no stub) are a
   * load-time error with no silent fallback.
   *
   * Heavy initialization (HTTP probes, retries) belongs elsewhere; this
   * factory should stay light and synchronous.
   */
  daemonClient?: (link: DaemonTransport) => Partial<DaemonClientHandlers>;

  /** Called after the module is loaded and tools are registered. */
  onLoad?: (ctx: ModuleRuntimeContext) => Promise<void> | void;

  /** Called on shutdown — clean up resources, close connections. */
  onUnload?: () => Promise<void> | void;

  /** Returns current health state. Only set by foreign modules with subprocess management. */
  getHealth?: () => ModuleHealth;

  /**
   * Optional runtime health check. Returns the module's current readiness state.
   * Must be fast (< 1s) — probe cached state or do a lightweight ping, not a full test.
   * Modules without a healthCheck are assumed healthy.
   */
  healthCheck?: () => HealthCheckResult | Promise<HealthCheckResult>;
};

/** Resolve tools from a KotaModule — handles both static array and factory function forms. */
export function resolveModuleTools(
  mod: KotaModule,
  ctx?: ModuleContext,
): ToolDef[] {
  if (!mod.tools) return [];
  if (typeof mod.tools === "function") {
    if (!ctx) throw new Error(`Module "${mod.name}" has tools factory but no context provided`);
    return mod.tools(ctx);
  }
  return mod.tools;
}

async function resolveContribution<T>(
  value: ModuleContribution<T> | undefined,
  ctx: ModuleContext,
): Promise<readonly T[]> {
  if (!value) return [];
  if (typeof value === "function") {
    return await value(ctx);
  }
  return value;
}

export async function resolveModuleWorkflows(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ModuleWorkflowContribution[]> {
  return resolveContribution(mod.workflows, ctx);
}

export async function resolveModuleChannels(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ChannelDef[]> {
  return resolveContribution(mod.channels, ctx);
}

export async function resolveModuleSkills(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly SkillDef[]> {
  return resolveContribution(mod.skills, ctx);
}

export async function resolveModuleAgents(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly AgentDef[]> {
  return resolveContribution(mod.agents, ctx);
}
