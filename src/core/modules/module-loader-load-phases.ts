import { registerConfigSlice } from "#core/config/config-slice.js";
import {
  getModuleEventRegistry,
  initModuleEventRegistry,
} from "#core/events/module-event.js";
import { registerTool } from "#core/tools/index.js";
import { registerCustomGroup } from "#core/tools/tool-groups.js";
import {
  collectDaemonClientFactory,
  collectLocalClientHandlers,
} from "./module-loader-clients.js";
import { attachModuleMetadata } from "./module-loader-metadata-phases.js";
import type { LoaderState } from "./module-loader-state.js";
import { moduleToolSnapshots } from "./module-loader-tool-snapshots.js";
import {
  type KotaModule,
  type ModuleRuntimeContext,
  resolveModuleChannels,
  resolveModuleTools,
  resolveModuleUiSurfaceSources,
  resolveModuleWorkflows,
  type ToolDef,
} from "./module-types.js";
import { validateUiSurfaceSourceRegistrations } from "./module-ui-surfaces.js";
import { printTerminalDiagnostic } from "./terminal-renderer.js";

/**
 * Cwd + lifecycle-mode the load phases need but that does not belong on the
 * shared mutable state. The orchestrator constructs this once per load() call
 * and passes it through the phase functions.
 */
export interface LoadPhasePolicy {
  cwd: string;
  isCommandsMode: boolean;
}

export function checkDuplicateModule(state: LoaderState, mod: KotaModule): void {
  if (state.modules.some((m) => m.name === mod.name)) {
    throw new Error(`Duplicate module name: "${mod.name}"`);
  }
}

export function checkDependencies(state: LoaderState, mod: KotaModule): void {
  if (!mod.dependencies) return;
  for (const dep of mod.dependencies) {
    if (!state.modules.some((m) => m.name === dep)) {
      throw new Error(
        `Module "${mod.name}" requires "${dep}" which is not loaded`,
      );
    }
  }
}

export function registerModuleConfigSlices(
  state: LoaderState,
  mod: KotaModule,
): void {
  if (!mod.configSlices) return;
  for (const slice of mod.configSlices) {
    const existing = state.registeredConfigKeys.get(slice.key);
    if (existing && existing !== mod.name) {
      throw new Error(
        `Module "${mod.name}" tried to register config key "${slice.key}" already claimed by "${existing}"`,
      );
    }
    registerConfigSlice(slice, mod.name);
    state.registeredConfigKeys.set(slice.key, mod.name);
  }
}

export function registerModuleEvents(mod: KotaModule): void {
  if (!mod.events || mod.events.length === 0) return;
  const registry = getModuleEventRegistry() ?? initModuleEventRegistry();
  for (const def of mod.events) {
    registry.register(mod.name, def);
  }
}

export function prepareModuleTools(
  policy: LoadPhasePolicy,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): ToolDef[] {
  if (policy.isCommandsMode) return [];
  const tools = resolveModuleTools(mod, ctx);
  for (const def of tools) {
    if (!def.effect) {
      throw new Error(
        `Module "${mod.name}" tool "${def.tool.name}" missing required metadata: effect`,
      );
    }
  }
  return tools;
}

export function commitModuleTools(
  state: LoaderState,
  mod: KotaModule,
  tools: readonly ToolDef[],
): void {
  for (const def of tools) {
    registerTool(def.tool, def.runner, mod.name, {
      effect: def.effect,
      ...(def.resolveEffect ? { resolveEffect: def.resolveEffect } : {}),
    });
    if (def.group) registerCustomGroup(def.group, [def.tool.name]);
  }
  state.moduleToolCounts.set(mod.name, tools.length);
  state.moduleToolDefs.set(
    mod.name,
    moduleToolSnapshots(tools),
  );
}

export async function attachModuleWorkflows(
  state: LoaderState,
  policy: LoadPhasePolicy,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): Promise<void> {
  const workflows = await resolveModuleWorkflows(mod, ctx);
  if (workflows.length === 0) return;
  const source = state.moduleSources.get(mod.name) ?? "project";
  const resolvedWorkflows = workflows.map((def) => {
    const withPath =
      "definitionPath" in def
        ? def
        : { ...def, definitionPath: `modules/${mod.name}` };
    const withRoot =
      withPath.moduleRoot !== undefined
        ? withPath
        : { ...withPath, moduleRoot: policy.cwd };
    return {
      ...withRoot,
      contributingModule: withRoot.contributingModule ?? mod.name,
      moduleSource: withRoot.moduleSource ?? source,
    };
  });
  state.moduleWorkflowDefs.set(mod.name, resolvedWorkflows);
  for (const def of resolvedWorkflows) {
    state.contributedWorkflows.push(def);
  }
}

export async function attachModuleChannels(
  state: LoaderState,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): Promise<void> {
  const channels = await resolveModuleChannels(mod, ctx);
  if (channels.length === 0) return;
  state.moduleChannelDefs.set(mod.name, channels);
  for (const def of channels) {
    state.contributedChannels.push(def);
  }
}

export async function attachModuleUiSurfaces(
  state: LoaderState,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): Promise<void> {
  const sources = await resolveModuleUiSurfaceSources(mod, ctx);
  if (sources.length === 0) return;
  validateUiSurfaceSourceRegistrations([
    ...[...state.moduleUiSurfaceSources.entries()].flatMap(([moduleName, registered]) =>
      registered.map((source) => ({ moduleName, source }))),
    ...sources.map((source) => ({ moduleName: mod.name, source })),
  ]);
  state.moduleUiSurfaceSources.set(mod.name, sources);
}

export function attachModuleCommands(
  state: LoaderState,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): void {
  if (!mod.commands) return;
  try {
    state.moduleCommands.set(mod.name, mod.commands(ctx));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.moduleCommandErrors.set(mod.name, msg);
    printTerminalDiagnostic(
      `[kota] Module "${mod.name}" command registration failed: ${msg}`,
      "error",
    );
  }
}

export function attachModuleRoutes(
  state: LoaderState,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): void {
  if (!mod.routes) return;
  try {
    state.moduleRoutes.set(mod.name, [...mod.routes(ctx)]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.moduleRouteErrors.set(mod.name, msg);
    printTerminalDiagnostic(
      `[kota] Module "${mod.name}" route registration failed: ${msg}`,
      "error",
    );
  }
}

export function attachModuleControlRoutes(
  state: LoaderState,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): void {
  if (!mod.controlRoutes) return;
  try {
    state.moduleControlRoutes.set(mod.name, [...mod.controlRoutes(ctx)]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.moduleControlRouteErrors.set(mod.name, msg);
    printTerminalDiagnostic(
      `[kota] Module "${mod.name}" control-route registration failed: ${msg}`,
      "error",
    );
  }
}

export async function runModuleOnLoad(
  policy: LoadPhasePolicy,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): Promise<void> {
  if (!mod.onLoad || policy.isCommandsMode) return;
  await mod.onLoad(ctx);
}

/**
 * Drive every load phase a single module passes through, in order. The early
 * phases (duplicate check, dependency check, config slices, module events)
 * run before context creation; this function owns everything from tool
 * registration onward and the final registry write.
 */
export async function runModuleLoadPhases(
  state: LoaderState,
  policy: LoadPhasePolicy,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
  verbose: boolean,
): Promise<void> {
  const tools = prepareModuleTools(policy, mod, ctx);
  await attachModuleWorkflows(state, policy, mod, ctx);
  await attachModuleChannels(state, mod, ctx);
  await attachModuleUiSurfaces(state, mod, ctx);
  state.moduleLocalClientNamespaces.set(
    mod.name,
    collectLocalClientHandlers(state.localClientHandlers, mod, ctx),
  );
  collectDaemonClientFactory(state.daemonClientFactories, mod);
  attachModuleCommands(state, mod, ctx);
  attachModuleRoutes(state, mod, ctx);
  attachModuleControlRoutes(state, mod, ctx);
  await attachModuleMetadata(state, policy, mod, ctx, tools);
  commitModuleTools(state, mod, tools);
  await runModuleOnLoad(policy, mod, ctx);

  state.modules.push(mod);
  state.moduleRegistry.set(mod.name, mod);
  if (verbose) {
    const tc = state.moduleToolCounts.get(mod.name) ?? 0;
    printTerminalDiagnostic(`[kota] Module "${mod.name}" loaded (${tc} tools)`);
  }
}
