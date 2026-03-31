/**
 * Public extension API — types needed to author a KOTA extension.
 *
 * Import from "kota/extension" in your extension's source:
 *
 *   import type { KotaExtension, ToolDef } from "kota/extension";
 *
 * These types are stable; internal KOTA types are not part of this contract.
 */

export type { AgentDef, SkillDef } from "./agent-types.js";
export type { ChannelAdapter, ChannelDef, ChannelStartContext } from "./channel.js";
export type {
  CreateSessionOptions,
  ExtensionContext,
  ExtensionEventProxy,
  ExtensionLogger,
  ExtensionSession,
  KotaExtension,
  RouteRegistration,
  ToolDef,
} from "./extension-types.js";
export type { ToolResult } from "./tools/tool-result.js";
