/**
 * Public module API — types needed to author a KOTA module.
 *
 * Import from "kota/module" in your module's source:
 *
 *   import type { KotaModule, ToolDef } from "kota/module";
 *
 * These types are stable; internal KOTA types are not part of this contract.
 */

export type { AgentDef, SkillDef } from "./core/agents/agent-types.js";
export type { ChannelAdapter, ChannelDef, ChannelOperatorIdentity, ChannelStartContext, ChannelUserIdentity } from "./core/channels/channel.js";
export type {
  CreateSessionOptions,
  KotaModule,
  ModuleContext,
  ModuleEventProxy,
  ModuleLogger,
  ModuleSession,
  RouteRegistration,
  ToolDef,
} from "./core/modules/module-types.js";
export type { ToolResult } from "./core/tools/tool-result.js";
