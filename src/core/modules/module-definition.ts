import type { Command } from "commander";
import type { AgentDef, SkillDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { ModuleConfigSlice } from "#core/config/config-slice.js";
import type { ModuleEventDef } from "#core/events/module-event.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { DaemonClientHandlers, LocalClientHandlers } from "#root/client/kota-client.generated.js";
import type {
  ModuleContext,
  ModuleContribution,
  ModuleRuntimeContext,
  ModuleWorkflowContribution,
} from "./module-context-types.js";
import type {
  ModuleCapabilityManifestInput,
  ModuleManifestEffectDeclaration,
} from "./module-manifest.js";
import type {
  ControlRouteRegistration,
  HealthCheckResult,
  ModuleBoundaryRecord,
  ModuleHealth,
  RouteRegistration,
  ToolDef,
} from "./module-types.js";
import type { UiSurfaceSource } from "./module-ui-surfaces.js";
import type { ModuleSetupRequirement } from "./setup-requirements.js";

/** Host-owned runtime instance returned by module activation. */
export type ModuleActivation = {
  dispose: () => Promise<void> | void;
};

/** The single declaration boundary for every project or installed module. */
export type KotaModule = {
  name: string;
  version?: string;
  description?: string;
  dependencies?: string[];
  configSlices?: readonly ModuleConfigSlice[];
  configSchema?: ModuleBoundaryRecord;
  events?: ReadonlyArray<ModuleEventDef>;
  tools?: ToolDef[] | ((ctx: ModuleContext) => ToolDef[]);
  commands?: (ctx: ModuleContext) => Command[];
  routes?: (ctx: ModuleContext) => RouteRegistration[];
  controlRoutes?: (ctx: ModuleContext) => ControlRouteRegistration[];
  workflows?: ModuleContribution<ModuleWorkflowContribution>;
  channels?: ModuleContribution<ChannelDef>;

  /** Side-effect-free sources projected live through the canonical assembler. */
  uiSurfaces?: ModuleContribution<UiSurfaceSource>;

  skills?: ModuleContribution<SkillDef>;
  agents?: ModuleContribution<AgentDef>;
  effects?: ModuleContribution<ModuleManifestEffectDeclaration>;
  setupRequirements?: ModuleContribution<ModuleSetupRequirement>;
  manifest?:
    | ModuleCapabilityManifestInput
    | ((ctx: ModuleContext) => ModuleCapabilityManifestInput);
  localClient?: (ctx: ModuleContext) => Partial<LocalClientHandlers>;
  daemonClient?: (link: DaemonTransport) => Partial<DaemonClientHandlers>;
  onLoad?: (
    ctx: ModuleRuntimeContext,
  ) => Promise<ModuleActivation | void> | ModuleActivation | void;
  /** @deprecated Return a disposer from `onLoad`; retained until module migrations finish. */
  onUnload?: () => Promise<void> | void;
  getHealth?: () => ModuleHealth;
  healthCheck?: () => HealthCheckResult | Promise<HealthCheckResult>;
};

export function resolveModuleTools(
  mod: KotaModule,
  ctx?: ModuleContext,
): ToolDef[] {
  if (!mod.tools) return [];
  if (typeof mod.tools === "function") {
    if (!ctx) {
      throw new Error(`Module "${mod.name}" has tools factory but no context provided`);
    }
    return mod.tools(ctx);
  }
  return mod.tools;
}

async function resolveContribution<T>(
  value: ModuleContribution<T> | undefined,
  ctx: ModuleContext,
): Promise<readonly T[]> {
  if (!value) return [];
  return typeof value === "function" ? await value(ctx) : value;
}

export function resolveModuleWorkflows(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ModuleWorkflowContribution[]> {
  return resolveContribution(mod.workflows, ctx);
}

export function resolveModuleChannels(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ChannelDef[]> {
  return resolveContribution(mod.channels, ctx);
}

export function resolveModuleUiSurfaceSources(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly UiSurfaceSource[]> {
  return resolveContribution(mod.uiSurfaces, ctx);
}

export function resolveModuleSkills(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly SkillDef[]> {
  return resolveContribution(mod.skills, ctx);
}

export function resolveModuleAgents(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly AgentDef[]> {
  return resolveContribution(mod.agents, ctx);
}

export function resolveModuleEffects(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ModuleManifestEffectDeclaration[]> {
  return resolveContribution(mod.effects, ctx);
}

export function resolveModuleSetupRequirements(
  mod: KotaModule,
  ctx: ModuleContext,
): Promise<readonly ModuleSetupRequirement[]> {
  return resolveContribution(mod.setupRequirements, ctx);
}
