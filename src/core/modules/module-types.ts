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
import type { DynamicStateContext } from "#core/loop/dynamic-state.js";
import type { PreSendHook } from "#core/loop/pre-send-hooks.js";
import type {
  KotaClient,
  LocalClientHandlers,
} from "#core/server/kota-client.js";
import type { ToolMiddlewareFn } from "#core/tools/tool-middleware.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinitionInput } from "#core/workflow/types.js";
import type { ModuleStorage } from "./module-storage.js";

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

/** Event proxy available to modules via ModuleContext. */
export type ModuleEventProxy = {
  /** Emit an event on the bus. No-op if bus not available. */
  emit(event: string, payload: Record<string, unknown>): void;
  /** Subscribe to a bus event. Returns an unsubscribe function. No-op (returns noop) if bus not available. */
  subscribe(event: string, handler: (payload: Record<string, unknown>) => void): () => void;
  /**
   * Number of subscribers for the given event name (or all events if omitted).
   * Returns 0 if the bus is not available.
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
  runner: (input: Record<string, unknown>) => Promise<ToolResult>;
  /** Tool group for progressive disclosure. Ungrouped tools are always available. */
  group?: string;
  risk: "safe" | "moderate" | "dangerous";
  kind: "discovery" | "action";
};

/** An HTTP route registered by a module. */
export type RouteRegistration = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /**
   * Exact path string for fixed routes. For routes with path parameters,
   * provide `pathPattern` instead and leave `path` as the base prefix.
   */
  path: string;
  /**
   * Optional regex for routes with path parameters. When present, matched
   * against the request pathname instead of exact `path` comparison.
   * The handler must extract parameters from `req.url` itself.
   */
  pathPattern?: RegExp;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  /**
   * When true, the server skips the bearer-token auth check for this route.
   * Use for inbound webhook endpoints that receive external deliveries without
   * a KOTA auth token (e.g. GitHub webhooks). The module must perform its
   * own request authentication (signature validation, etc.).
   */
  bypassAuth?: boolean;
};

/**
 * An HTTP route registered by a module on the daemon-control server.
 *
 * The daemon-control surface is capability-scoped: every request is
 * classified as a `read` or `control` call before the handler runs.
 * Modules contribute these routes through `KotaModule.controlRoutes`
 * instead of adding entries to a core-hosted route table. The method +
 * path must not collide with any built-in daemon-control route or with
 * another module's contribution — the server rejects collisions loudly at
 * startup.
 *
 * Paths may include `:name` segments to capture path parameters. The
 * router extracts them once and passes them to the handler as the third
 * argument.
 */
export type ControlRouteRegistration = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /**
   * Request path. May include `:name` segments for path parameters; the
   * extracted values arrive in the handler's `params` argument.
   */
  path: string;
  /**
   * Capability scope required to invoke the route.
   * - "read": observe daemon state
   * - "control": mutate daemon state or trigger external side effects
   */
  capabilityScope: CapabilityScope;
  /**
   * When true, the daemon-control server skips the bearer-token auth check
   * for this route. Use for inbound webhook endpoints whose auth is
   * carried in a per-request signature header rather than the daemon's
   * Bearer token (e.g. `POST /webhooks/:name`). The module must perform
   * its own request authentication. Mirrors `RouteRegistration.bypassAuth`.
   */
  bypassAuth?: boolean;
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ) => void | Promise<void>;
};

export type ModuleContribution<T> =
  | readonly T[]
  | ((ctx: ModuleContext) => readonly T[] | Promise<readonly T[]>);

export type ModuleWorkflowContribution =
  | WorkflowDefinitionInput
  | RegisteredWorkflowDefinitionInput;

/** Context provided to modules during initialization. */
export type ModuleContext = {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  /** Scoped file-based storage for this module (`.kota/modules/<name>/`). */
  storage: ModuleStorage;
  /** Register a custom tool group with optional auto-detect regex. */
  registerGroup: (name: string, toolNames: string[], pattern?: RegExp) => void;
  /** Get HTTP routes registered by all loaded modules. Decouples modules from each other. */
  getRoutes: () => RouteRegistration[];
  /** Get daemon-control HTTP routes contributed by all loaded modules. */
  getContributedControlRoutes: () => ControlRouteRegistration[];
  /** Get workflow definitions contributed by loaded modules. */
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  /** Get channel definitions contributed by loaded modules. */
  getContributedChannels: () => ChannelDef[];
  /** Get this module's config section from the KOTA config. */
  getModuleConfig: <T = Record<string, unknown>>() => T | undefined;
  /** Scoped logger — messages prefixed with `[module:<name>]`. */
  log: ModuleLogger;
  /** Get a secret value by name. Returns null if not found or store not initialized. */
  getSecret: (key: string) => string | null;
  /** List names of all currently registered tools. */
  listTools: () => string[];
  /** Event proxy for emitting and subscribing to bus events. */
  events: ModuleEventProxy;
  /** Create an agent session without importing core types. */
  createSession: (options?: CreateSessionOptions) => ModuleSession;
  /** Register this module as a provider for a service type (e.g., "memory", "knowledge"). */
  registerProvider: (type: string, provider: unknown) => void;
  /** Get the active provider for a service type. Returns null if none registered. */
  getProvider: <T>(type: string) => T | null;
  /** Invoke a registered tool directly without going through the LLM. Skips guardrails. */
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  /** Register a middleware that wraps tool execution. Lower priority runs first. */
  registerMiddleware: (name: string, fn: ToolMiddlewareFn, priority?: number) => void;
  /** Get summaries of all loaded modules (name, version, contribution counts). */
  getModuleSummaries: () => ModuleSummary[];
  /**
   * Register a per-turn dynamic system-prompt state provider.
   * The function is called synchronously on every agent turn with the
   * effective tool set for the turn, and its output is appended to the
   * dynamic system-prompt block. Use this to contribute module state
   * (e.g. working memory contents, conversational-pattern guidance for a
   * tool the session admits) without modifying core.
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
  /** Look up a registered agent definition by name. */
  resolveAgentDef: (name: string) => AgentDef | undefined;
  /** Build the skills prompt for a set of skill names or "all", optionally filtered by agent name. */
  resolveSkillsPrompt: (skillNames: string[] | "all", agentName?: string) => string;
  /** Probe all modules that declare a healthCheck and return results. */
  probeHealthChecks: () => Promise<Record<string, HealthCheckResult>>;
  /** Top-level config keys registered by loaded modules. */
  getRegisteredConfigKeys: () => ReadonlySet<string>;
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

  /** Called after the module is loaded and tools are registered. */
  onLoad?: (ctx: ModuleContext) => Promise<void> | void;

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
