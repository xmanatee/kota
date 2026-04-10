/**
 * KotaModule protocol — the standard unit of functionality in KOTA.
 *
 * A module can register tools, CLI commands, HTTP routes, and event
 * subscriptions. Project and third-party modules use the same
 * protocol.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type Anthropic from "@anthropic-ai/sdk";
import type { Command } from "commander";
import type { AgentDef, SkillDef } from "./agent-types.js";
import type { ChannelDef } from "./channel.js";
import type { KotaConfig } from "./config.js";
import type { ModuleStorage } from "./module-storage.js";
import type { ToolMiddlewareFn } from "./tool-middleware.js";
import type { ToolResult } from "./tools/tool-result.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinitionInput } from "./workflow/types.js";

/** Health state for a foreign (KEMP) module subprocess. */
export type ModuleHealth = {
  status: "ok" | "restarting" | "dead";
  restartCount: number;
  lastRestartAt?: string;
};

/** Summary of a loaded module's metadata and contributions. */
export type ModuleSummary = {
  name: string;
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
  tool: Anthropic.Tool;
  runner: (input: Record<string, unknown>) => Promise<ToolResult>;
  /** Tool group for progressive disclosure. Ungrouped tools are always available. */
  group?: string;
  /**
   * Risk classification for guardrails. When provided, the guardrails system
   * uses this instead of the default unclassified-tool classification.
   * - safe: read-only, no side effects
   * - moderate: mutates local state in controlled ways
   * - dangerous: destructive or high-impact operations
   */
  risk?: "safe" | "moderate" | "dangerous";
  /**
   * Capability category for phase-level safety checks.
   * - discovery: read-only, no side effects (reads, search, listing)
   * - action: can modify state (writes, execution, network mutations)
   */
  kind?: "discovery" | "action";
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
   * The function is called synchronously on every agent turn and its output
   * is appended to the dynamic system-prompt block. Use this to contribute
   * module state (e.g. working memory contents) without modifying core.
   */
  registerDynamicStateProvider: (name: string, fn: () => string) => void;
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
 * Shipped modules use the same protocol as external ones.
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

  /** Called after the module is loaded and tools are registered. */
  onLoad?: (ctx: ModuleContext) => Promise<void> | void;

  /** Called on shutdown — clean up resources, close connections. */
  onUnload?: () => Promise<void> | void;

  /** Returns current health state. Only set by foreign modules with subprocess management. */
  getHealth?: () => ModuleHealth;
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
