import type { Command } from "commander";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { DaemonClientHandlers, LocalClientHandlers } from "#core/server/kota-client.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { readImportedSkillRecords } from "./imported-skills.js";
import { type LifecycleEnv, unloadAllModules, unloadModule } from "./module-lifecycle.js";
import { type LoadAllEnv, loadAllModules, reloadModule } from "./module-loader-bootstrap.js";
import { assembleDaemonClientHandlers as assembleDaemonClientHandlersImpl } from "./module-loader-clients.js";
import { createLoaderModuleContext, type ToolCallDepth } from "./module-loader-context.js";
import {
  checkDependencies,
  checkDuplicateModule,
  type LoadPhasePolicy,
  registerModuleConfigSlices,
  registerModuleEvents,
  runModuleLoadPhases,
} from "./module-loader-load-phases.js";
import { createLoaderState, type LoaderState } from "./module-loader-state.js";
import { collectModuleSummaries, formatSkillsPrompt } from "./module-loader-summaries.js";
import type { ModuleStorage } from "./module-storage.js";
import type {
  ControlRouteRegistration,
  CreateSessionOptions,
  HealthCheckResult,
  KotaModule,
  ModuleRuntimeContext,
  ModuleSession,
  ModuleSummary,
  RouteRegistration,
} from "./module-types.js";

export type { ModuleSource, ModuleSummary } from "./module-types.js";

/**
 * Lifecycle mode the loader operates in. `"commands"` populates static
 * contributions for cheap CLI startup but skips `onLoad`, tools, foreign
 * modules, and provider activation; runtime-only accessors throw rather than
 * hand back a partial snapshot. `"runtime"` drives every module's lifecycle
 * to completion. See `src/core/modules/AGENTS.md` for the full contract.
 */
export type ModuleLoaderMode = "commands" | "runtime";

export type ModuleLoaderOptions = {
  /** Lifecycle mode this loader operates in. Defaults to `"runtime"`. */
  mode?: ModuleLoaderMode;
};

type RuntimeOnlyGetter = "getRoutes" | "getContributedControlRoutes" | "probeHealthChecks";

export class ModuleLoader {
  private readonly state: LoaderState = createLoaderState();
  private readonly verbose: boolean;
  private readonly config: KotaConfig;
  private readonly mode: ModuleLoaderMode;
  private cwd: string;
  private bus: EventBus | null = null;
  private sessionFactory: ((opts: CreateSessionOptions) => ModuleSession) | null = null;
  private toolCallDepth: ToolCallDepth = { value: 0 };

  constructor(config: KotaConfig, verbose = false, options?: ModuleLoaderOptions) {
    this.config = config;
    this.verbose = verbose;
    this.cwd = process.cwd();
    this.mode = options?.mode ?? "runtime";
  }

  getMode(): ModuleLoaderMode { return this.mode; }
  setSessionFactory(factory: (opts: CreateSessionOptions) => ModuleSession): void { this.sessionFactory = factory; }
  setCwd(cwd: string): void { this.cwd = cwd; }
  setBus(bus: EventBus): void { this.bus = bus; }

  private get isCommandsMode(): boolean { return this.mode === "commands"; }

  private assertRuntime(getter: RuntimeOnlyGetter): void {
    if (!this.isCommandsMode) return;
    throw new Error(
      `ModuleLoader.${getter}() requires lifecycle mode "runtime"; this loader is in "commands" mode. ` +
        `A "commands" loader skips onLoad / provider activation, so route handlers and module health ` +
        `probes would call into unregistered providers. Construct a runtime loader ` +
        `(loadRuntimeModules() or new ModuleLoader(config, verbose, { mode: "runtime" })) before ` +
        `consuming routes, control routes, or health checks.`,
    );
  }

  private get lifecycleEnv(): LifecycleEnv {
    return { resetBus: () => { this.bus = null; }, verbose: this.verbose };
  }

  private get loadAllEnv(): LoadAllEnv {
    return { config: this.config, cwd: this.cwd, verbose: this.verbose, isCommandsMode: this.isCommandsMode };
  }

  private createContext(moduleName?: string): ModuleRuntimeContext {
    return createLoaderModuleContext(
      {
        cwd: this.cwd,
        verbose: this.verbose,
        config: this.config,
        moduleStorages: this.state.moduleStorages,
        getBus: () => this.bus,
        getRoutes: () => this.getRoutes(),
        getContributedControlRoutes: () => this.getContributedControlRoutes(),
        getContributedWorkflows: () => this.getContributedWorkflows(),
        getContributedChannels: () => this.getContributedChannels(),
        getModuleSummaries: () => this.getModuleSummaries(),
        resolveAgentDef: (name) => this.getAgentDef(name),
        resolveSkillsPrompt: (names, agentName) => this.getSkillsPromptFor(names, agentName),
        getSessionFactory: () => this.sessionFactory,
        probeHealthChecks: () => this.probeHealthChecks(),
        getRegisteredConfigKeys: () => this.getRegisteredConfigKeys(),
      },
      this.toolCallDepth,
      moduleName,
    );
  }

  async load(mod: KotaModule): Promise<void> {
    const state = this.state;
    const policy: LoadPhasePolicy = { cwd: this.cwd, isCommandsMode: this.isCommandsMode };

    checkDuplicateModule(state, mod);
    checkDependencies(state, mod);
    registerModuleConfigSlices(state, mod);
    registerModuleEvents(mod);

    const ctx = this.createContext(mod.name);
    await runModuleLoadPhases(state, policy, mod, ctx, this.verbose);
  }

  async loadAll(projectModules: KotaModule[], installedModules?: KotaModule[]): Promise<void> {
    await loadAllModules(this.state, this.loadAllEnv, (mod) => this.load(mod), () => this.getToolCount(), projectModules, installedModules);
  }

  async unload(moduleName: string): Promise<boolean> {
    return await unloadModule(moduleName, this.state, this.lifecycleEnv);
  }

  async unloadAll(): Promise<void> {
    await unloadAllModules(this.state, this.lifecycleEnv);
  }

  async reload(moduleName: string): Promise<boolean> {
    return await reloadModule(
      moduleName,
      this.state,
      { cwd: this.cwd, verbose: this.verbose },
      (mod) => this.load(mod),
      (name) => this.unload(name),
    );
  }

  getDependents(moduleName: string): string[] {
    return this.state.modules.filter((m) => m.dependencies?.includes(moduleName)).map((m) => m.name);
  }

  getLocalClientHandlers(): Partial<LocalClientHandlers> {
    return { ...this.state.localClientHandlers };
  }

  assembleDaemonClientHandlers(transport: DaemonTransport): Partial<DaemonClientHandlers> {
    return assembleDaemonClientHandlersImpl(this.state.daemonClientFactories, transport);
  }

  private collectFromModules<T>(getMap: (name: string) => readonly T[] | undefined): T[] {
    const out: T[] = [];
    for (const mod of this.state.modules) {
      const cached = getMap(mod.name);
      if (cached) out.push(...cached);
    }
    return out;
  }

  getCommands(): Command[] {
    return this.collectFromModules((name) => this.state.moduleCommands.get(name));
  }

  getRoutes(): RouteRegistration[] {
    this.assertRuntime("getRoutes");
    return this.collectFromModules((name) => this.state.moduleRoutes.get(name));
  }

  getContributedControlRoutes(): ControlRouteRegistration[] {
    this.assertRuntime("getContributedControlRoutes");
    return this.collectFromModules((name) => this.state.moduleControlRoutes.get(name));
  }

  getContributedWorkflows(): RegisteredWorkflowDefinitionInput[] { return this.state.contributedWorkflows; }
  getContributedChannels(): ChannelDef[] { return this.state.contributedChannels; }

  getSkillsPrompt(): string { return this.getSkillsPromptFor("all"); }

  getSkillsPromptFor(skillNames: string[] | "all", agentName?: string): string {
    this.refreshImportedSkills();
    return formatSkillsPrompt(
      this.state.skillContentsByName,
      this.state.skillDefsByName,
      this.state.explicitOnlySkillNames,
      skillNames,
      agentName,
    );
  }

  private refreshImportedSkills(): void {
    const records = readImportedSkillRecords(this.cwd);
    const moduleSkillNames = new Set<string>();
    for (const skills of this.state.moduleSkillDefs.values()) {
      for (const skill of skills) moduleSkillNames.add(skill.name);
    }

    for (const name of this.state.importedSkillNames) {
      if (!moduleSkillNames.has(name)) {
        this.state.skillContentsByName.delete(name);
        this.state.skillDefsByName.delete(name);
      }
      this.state.explicitOnlySkillNames.delete(name);
    }
    this.state.importedSkillNames.clear();

    for (const record of records) {
      if (moduleSkillNames.has(record.def.name)) continue;
      this.state.skillContentsByName.set(record.def.name, record.content);
      this.state.skillDefsByName.set(record.def.name, record.def);
      this.state.importedSkillNames.add(record.def.name);
      this.state.explicitOnlySkillNames.add(record.def.name);
    }
  }

  getAgentDef(name: string): AgentDef | undefined {
    for (const agents of this.state.moduleAgentDefs.values()) {
      const found = agents.find((a) => a.name === name);
      if (found) return found;
    }
    return undefined;
  }

  getRegisteredConfigKeys(): ReadonlySet<string> {
    return new Set(this.state.registeredConfigKeys.keys());
  }

  getModuleStorage(moduleName: string): ModuleStorage | undefined {
    return this.state.moduleStorages.get(moduleName);
  }

  getLoadedModules(): string[] { return this.state.modules.map((e) => e.name); }
  getModuleCount(): number { return this.state.modules.length; }

  getToolCount(): number {
    if (this.isCommandsMode) return 0;
    let total = 0;
    for (const count of this.state.moduleToolCounts.values()) total += count;
    return total;
  }

  getModuleSummaries(): ModuleSummary[] { return collectModuleSummaries(this.state); }

  async probeHealthChecks(): Promise<Record<string, HealthCheckResult>> {
    this.assertRuntime("probeHealthChecks");
    const results: Record<string, HealthCheckResult> = {};
    for (const mod of this.state.modules) {
      if (!mod.healthCheck) continue;
      try {
        results[mod.name] = await mod.healthCheck();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results[mod.name] = { status: "unhealthy", message: `healthCheck threw: ${msg}` };
      }
    }
    return results;
  }
}
