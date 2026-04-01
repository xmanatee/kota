/**
 * KotaExtension protocol — the standard unit of functionality in KOTA.
 *
 * An extension can register tools, CLI commands, HTTP routes, and event
 * subscriptions. Built-in features and third-party extensions use the
 * same protocol.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type Anthropic from "@anthropic-ai/sdk";
import type { Command } from "commander";
import type { AgentDef, SkillDef } from "./agent-types.js";
import type { ChannelDef } from "./channel.js";
import type { KotaConfig } from "./config.js";
import type { ExtensionStorage } from "./extension-storage.js";
import type { ToolMiddlewareFn } from "./tool-middleware.js";
import type { ToolResult } from "./tools/tool-result.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinitionInput } from "./workflow/types.js";

/** Health state for a foreign (KEMP) extension subprocess. */
export type ExtensionHealth = {
  status: "ok" | "restarting" | "dead";
  restartCount: number;
  lastRestartAt?: string;
};

/** Summary of a loaded extension's metadata and contributions. */
export type ExtensionSummary = {
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
  health?: ExtensionHealth;
};

/** Scoped logger available to extensions via ExtensionContext. */
export type ExtensionLogger = {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  debug: (msg: string, data?: unknown) => void;
};

/** Event proxy available to extensions via ExtensionContext. */
export type ExtensionEventProxy = {
  /** Emit an event on the bus. No-op if bus not available. */
  emit(event: string, payload: Record<string, unknown>): void;
  /** Subscribe to a bus event. Returns an unsubscribe function. No-op (returns noop) if bus not available. */
  subscribe(event: string, handler: (payload: Record<string, unknown>) => void): () => void;
};

/** Minimal session interface returned by ctx.createSession(). */
export type ExtensionSession = {
  /** Send a prompt and get the response text. */
  send(prompt: string): Promise<string>;
  /** Close the session and release resources. */
  close(): void;
};

/** Options for ctx.createSession(). */
export type CreateSessionOptions = {
  model?: string;
  label?: string;
  /** If true, conversation won't be saved to history. Default: true for extension sessions. */
  noHistory?: boolean;
};

/** A tool definition — used by extensions and plugins alike. */
export type ToolDef = {
  tool: Anthropic.Tool;
  runner: (input: Record<string, unknown>) => Promise<ToolResult>;
  /** Tool group for progressive disclosure. Ungrouped tools are always available. */
  group?: string;
};

/** An HTTP route registered by an extension. */
export type RouteRegistration = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
};

/** Context provided to extensions during initialization. */
export type ExtensionContext = {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  /** Scoped file-based storage for this extension (`.kota/extensions/<name>/`). */
  storage: ExtensionStorage;
  /** Register a custom tool group with optional auto-detect regex. */
  registerGroup: (name: string, toolNames: string[], pattern?: RegExp) => void;
  /** Get HTTP routes registered by all loaded extensions. Decouples extensions from each other. */
  getRoutes: () => RouteRegistration[];
  /** Get workflow definitions contributed by loaded extensions. */
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  /** Get channel definitions contributed by loaded extensions. */
  getContributedChannels: () => ChannelDef[];
  /** Get this extension's config section from the KOTA config. */
  getExtensionConfig: <T = Record<string, unknown>>() => T | undefined;
  /** Scoped logger — messages prefixed with `[extension:<name>]`. */
  log: ExtensionLogger;
  /** Get a secret value by name. Returns null if not found or store not initialized. */
  getSecret: (key: string) => string | null;
  /** List names of all currently registered tools. */
  listTools: () => string[];
  /** Event proxy for emitting and subscribing to bus events. */
  events: ExtensionEventProxy;
  /** Create an agent session without importing core types. */
  createSession: (options?: CreateSessionOptions) => ExtensionSession;
  /** Register this extension as a provider for a service type (e.g., "memory", "knowledge"). */
  registerProvider: (type: string, provider: unknown) => void;
  /** Get the active provider for a service type. Returns null if none registered. */
  getProvider: <T>(type: string) => T | null;
  /** Invoke a registered tool directly without going through the LLM. Skips guardrails. */
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  /** Register a middleware that wraps tool execution. Lower priority runs first. */
  registerMiddleware: (name: string, fn: ToolMiddlewareFn, priority?: number) => void;
  /** Get summaries of all loaded extensions (name, version, contribution counts). */
  getExtensionSummaries: () => ExtensionSummary[];
};

/**
 * KotaExtension — the pluggable unit of KOTA functionality.
 *
 * Extensions extend KOTA's capabilities through a declarative protocol:
 * - `tools` — register agent tools
 * - `commands` — add CLI subcommands (appear in `kota --help`)
 * - `routes` — add HTTP endpoints (available when server runs)
 * - `workflows` — contribute automation (event, cron, interval, idle)
 *
 * Built-in extensions ship with KOTA but use the same protocol as external ones.
 * The core without any extensions loaded still functions as a basic agent.
 */
export type KotaExtension = {
  /** Unique extension identifier (e.g. "memory", "telegram", "web"). */
  name: string;
  /** Semver version string. */
  version?: string;
  /** Short description of what this extension does. */
  description?: string;
  /** Names of extensions that must be loaded before this one. */
  dependencies?: string[];

  /**
   * Tools this extension provides. Registered during load.
   * Can be a static array or a factory that receives ExtensionContext,
   * allowing tool runners to access extension services via closure.
   */
  tools?: ToolDef[] | ((ctx: ExtensionContext) => ToolDef[]);

  /**
   * CLI commands this extension adds. Called once at load time.
   * Returned commands are added to the main program — they appear in `kota --help`.
   */
  commands?: (ctx: ExtensionContext) => Command[];

  /**
   * HTTP routes this extension adds. Called when the server starts.
   * Routes are matched by method + path in the HTTP request handler.
   */
  routes?: (ctx: ExtensionContext) => RouteRegistration[];

  /**
   * Workflow definitions this extension contributes.
   * Contributed workflows are registered alongside built-in workflows and support
   * the same trigger types: event, cron schedule, interval, and runtime.idle.
   * Use workflows to express hook-like reactions, heartbeat jobs, and scheduled
   * automation instead of subscribing to the event bus directly.
   */
  workflows?: WorkflowDefinitionInput[];

  /**
   * Channel definitions this extension contributes.
   * Channels are daemon-owned interaction surfaces that map external I/O to sessions.
   * The daemon starts contributed channels at startup and stops them on shutdown.
   * A channel returns null from its factory if it cannot start (missing credentials).
   */
  channels?: ChannelDef[];

  /**
   * Skills this extension contributes — named, file-backed guidance blocks.
   * Skills are the one way to teach the agent about extension capabilities.
   */
  skills?: SkillDef[];

  /**
   * Agent definitions this extension contributes.
   * Registered agents can be referenced by name in workflow agent steps.
   */
  agents?: AgentDef[];

  /** Called after the extension is loaded and tools are registered. */
  onLoad?: (ctx: ExtensionContext) => Promise<void> | void;

  /** Called on shutdown — clean up resources, close connections. */
  onUnload?: () => Promise<void> | void;

  /** Returns current health state. Only set by foreign extensions with subprocess management. */
  getHealth?: () => ExtensionHealth;
};

/** Resolve tools from a KotaExtension — handles both static array and factory function forms. */
export function resolveExtensionTools(
  mod: KotaExtension,
  ctx?: ExtensionContext,
): ToolDef[] {
  if (!mod.tools) return [];
  if (typeof mod.tools === "function") {
    if (!ctx) throw new Error(`Module "${mod.name}" has tools factory but no context provided`);
    return mod.tools(ctx);
  }
  return mod.tools;
}
