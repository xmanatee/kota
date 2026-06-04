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
export type { CapabilityScope } from "./core/daemon/daemon-control-types.js";
export type {
  ControlRouteRegistration,
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
export type {
  AutomationDefinitionInput,
  AutomationKind,
  HookDefinitionInput,
} from "./core/workflow/automation.js";
export {
  defineAutomation,
  defineHook,
} from "./core/workflow/automation.js";
