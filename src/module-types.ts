/**
 * KotaModule protocol — the standard unit of functionality in KOTA.
 *
 * A module can register tools, CLI commands, HTTP routes, and event
 * subscriptions. Built-in features and third-party extensions use the
 * same protocol. See plans/modular-architecture.md for the full vision.
 */

import type { Command } from "commander";
import type { IncomingMessage, ServerResponse } from "node:http";
import type Anthropic from "@anthropic-ai/sdk";
import type { KotaConfig } from "./config.js";
import type { EventBus } from "./event-bus.js";
import type { ToolResult } from "./tools/index.js";

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
export type ModuleContext = {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  /** Register a custom tool group with optional auto-detect regex. */
  registerGroup: (name: string, toolNames: string[], pattern?: RegExp) => void;
  /** Get HTTP routes registered by all loaded modules. Decouples modules from each other. */
  getRoutes: () => RouteRegistration[];
};

/**
 * KotaModule — the pluggable unit of KOTA functionality.
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
export type KotaModule = {
  /** Unique module identifier (e.g. "memory", "telegram", "web"). */
  name: string;
  /** Semver version string. */
  version?: string;
  /** Short description of what this module does. */
  description?: string;
  /** Names of modules that must be loaded before this one. */
  dependencies?: string[];

  /** Tools this module provides. Registered during load. */
  tools?: ToolDef[];

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
   * Event subscriptions. Called once when events are connected.
   * Must return an array of unsubscribe functions for cleanup.
   */
  events?: (bus: EventBus) => (() => void)[];

  /** Called after the module is loaded and tools are registered. */
  onLoad?: (ctx: ModuleContext) => Promise<void> | void;

  /** Called on shutdown — clean up resources, close connections. */
  onUnload?: () => Promise<void> | void;
};
