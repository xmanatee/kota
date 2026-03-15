import type Anthropic from "@anthropic-ai/sdk";
import type { ToolResult } from "./tools/index.js";

/** A tool provided by a plugin. */
export type ToolDefinition = {
  /** Anthropic tool schema (name, description, input_schema) */
  tool: Anthropic.Tool;
  /** Function that executes when the tool is called */
  runner: (input: Record<string, unknown>) => Promise<ToolResult>;
  /** Optional tool group — grouped tools follow progressive disclosure (enable_tools).
   *  Ungrouped tools are always available. */
  group?: string;
};

/** Context available to plugins during initialization. */
export type PluginContext = {
  /** Current working directory */
  cwd: string;
  /** Whether verbose/debug logging is on */
  verbose: boolean;
  /** Register a custom tool group with optional auto-detect regex */
  registerGroup: (name: string, toolNames: string[], pattern?: RegExp) => void;
};

/**
 * Standard interface for KOTA plugins.
 *
 * A plugin is a JS/MJS module that default-exports a KotaPlugin object.
 * Place plugin files in `.kota/plugins/` — they are auto-discovered on startup.
 *
 * Example:
 * ```js
 * // .kota/plugins/hello.mjs
 * export default {
 *   name: "hello",
 *   tools: [{
 *     tool: { name: "hello", description: "Say hello", input_schema: { type: "object", properties: {} } },
 *     runner: async () => ({ content: "Hello from plugin!" }),
 *   }],
 * };
 * ```
 */
export type KotaPlugin = {
  /** Unique plugin identifier */
  name: string;
  /** Semver version string */
  version?: string;
  /** Tools this plugin provides */
  tools?: ToolDefinition[];
  /** Called after the plugin is loaded and tools are registered */
  onLoad?: (ctx: PluginContext) => Promise<void> | void;
  /** Called when the session closes — clean up resources here */
  onUnload?: () => Promise<void> | void;
};
