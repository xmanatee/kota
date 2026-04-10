/**
 * Public module API — types needed to author a KOTA module.
 *
 * Import from "kota/module" in your module's source:
 *
 *   import type { KotaModule, ToolDef } from "kota/module";
 *
 * These types are stable; internal KOTA types are not part of this contract.
 */

export type { AgentDef, SkillDef } from "./agent-types.js";
export type { ChannelAdapter, ChannelDef, ChannelStartContext } from "./channel.js";
export type {
  CreateSessionOptions,
  KotaModule,
  ModuleContext,
  ModuleEventProxy,
  ModuleLogger,
  ModuleSession,
  RouteRegistration,
  ToolDef,
} from "./module-types.js";
export type { ToolResult } from "./tools/tool-result.js";
