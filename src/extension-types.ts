/**
 * KotaExtension protocol — the standard unit of functionality in KOTA.
 *
 * A module can register tools, CLI commands, HTTP routes, and event
 * subscriptions. Built-in features and third-party extensions use the
 * same protocol.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type Anthropic from "@anthropic-ai/sdk";
import type { Command } from "commander";
import type { AgentDef, SkillDef } from "./agent-types.js";
import type { KotaConfig } from "./config.js";
import type { EventBus } from "./event-bus.js";
import type { ExtensionStorage } from "./extension-storage.js";
import type { ToolMiddlewareFn } from "./tool-middleware.js";
import type { ToolResult } from "./tools/tool-result.js";

/** Scoped logger available to modules via ExtensionContext. */
export type ExtensionLogger = {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  debug: (msg: string, data?: unknown) => void;
};

/** Event proxy available to modules via ExtensionContext. */
export type ExtensionEventProxy = {
  /** Emit an event on the bus. No-op if bus not available. */
  emit(event: string, payload: Record<string, unknown>): void;
  /** Subscribe to an event. Returns unsubscribe function. No-op if bus not available. */
  on(event: string, handler: (payload: Record<string, unknown>) => void): () => void;
  /** Subscribe once, auto-unsubscribe after first call. Returns unsubscribe function. */
  once(event: string, handler: (payload: Record<string, unknown>) => void): () => void;
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
  /** If true, conversation won't be saved to history. Default: true for module sessions. */
  noHistory?: boolean;
};

/** A tool definition — used by modules and plugins alike. */
export type ToolDef = {
  tool: Anthropic.Tool;
  runner: (input: Record<string, unknown>) => Promise<ToolResult>;
  /** Tool group for progressive disclosure. Ungrouped tools are always available. */
  group?: string;
};

/** An HTTP route registered by a module. */
export type RouteRegistration = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
};

/** Context provided to modules during initialization. */
export type ExtensionContext = {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  /** Scoped file-based storage for this module (`.kota/modules/<name>/`). */
  storage: ExtensionStorage;
  /** Register a custom tool group with optional auto-detect regex. */
  registerGroup: (name: string, toolNames: string[], pattern?: RegExp) => void;
  /** Get HTTP routes registered by all loaded modules. Decouples modules from each other. */
  getRoutes: () => RouteRegistration[];
  /** Get this module's config section from the KOTA config. */
  getModuleConfig: <T = Record<string, unknown>>() => T | undefined;
  /** Scoped logger — messages prefixed with `[module:<name>]`. */
  log: ExtensionLogger;
  /** Get a secret value by name. Returns null if not found or store not initialized. */
  getSecret: (key: string) => string | null;
  /** List names of all currently registered tools. */
  listTools: () => string[];
  /** Event proxy for emitting and subscribing to bus events. */
  events: ExtensionEventProxy;
  /** Create an agent session without importing core types. */
  createSession: (options?: CreateSessionOptions) => ExtensionSession;
  /** Register this module as a provider for a service type (e.g., "memory", "knowledge"). */
  registerProvider: (type: string, provider: unknown) => void;
  /** Get the active provider for a service type. Returns null if none registered. */
  getProvider: <T>(type: string) => T | null;
  /** Invoke a registered tool directly without going through the LLM. Skips guardrails. */
  callTool: (name: string, input: Record<string, unknown>) => Promise<ToolResult>;
  /** Register a middleware that wraps tool execution. Lower priority runs first. */
  registerMiddleware: (name: string, fn: ToolMiddlewareFn, priority?: number) => void;
};

/**
 * KotaExtension — the pluggable unit of KOTA functionality.
 *
 * Modules extend KOTA's capabilities through a declarative protocol:
 * - `tools` — register agent tools
 * - `commands` — add CLI subcommands (appear in `kota --help`)
 * - `routes` — add HTTP endpoints (available when server runs)
 * - `events` — subscribe to the event bus
 *
 * Built-in modules ship with KOTA but use the same protocol as external ones.
 * The core without any modules loaded still functions as a basic agent.
 */
export type KotaExtension = {
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
   * Can be a static array or a factory that receives ExtensionContext,
   * allowing tool runners to access module services via closure.
   */
  tools?: ToolDef[] | ((ctx: ExtensionContext) => ToolDef[]);

  /**
   * CLI commands this module adds. Called once at load time.
   * Returned commands are added to the main program — they appear in `kota --help`.
   */
  commands?: (ctx: ExtensionContext) => Command[];

  /**
   * HTTP routes this module adds. Called when the server starts.
   * Routes are matched by method + path in the HTTP request handler.
   */
  routes?: (ctx: ExtensionContext) => RouteRegistration[];

  /**
   * Event subscriptions. Called once when events are connected.
   * Must return an array of unsubscribe functions for cleanup.
   */
  events?: (bus: EventBus) => (() => void)[];

  /**
   * Skills this extension contributes — named, file-backed guidance blocks.
   * Skills are the preferred way to teach the agent about extension capabilities.
   * Use promptSection for inline (non-file) guidance.
   */
  skills?: SkillDef[];

  /**
   * Agent definitions this extension contributes.
   * Registered agents can be referenced by name in workflow agent steps.
   */
  agents?: AgentDef[];

  /**
   * System prompt section this module contributes.
   * Returned string is appended to the system prompt under a heading.
   * Enables modules to teach the agent how to use their capabilities.
   * Called once after load; return null/undefined to skip.
   * Prefer skills for file-backed guidance.
   */
  promptSection?: (ctx: ExtensionContext) => string | undefined;

  /** Called after the module is loaded and tools are registered. */
  onLoad?: (ctx: ExtensionContext) => Promise<void> | void;

  /** Called on shutdown — clean up resources, close connections. */
  onUnload?: () => Promise<void> | void;
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
