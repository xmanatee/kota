import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { AgentDef, SkillDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import {
  registerConfigSlice,
  unregisterConfigSlicesForOwner,
} from "#core/config/config-slice.js";
import type { EventBus } from "#core/events/event-bus.js";
import {
  getModuleEventRegistry,
  initModuleEventRegistry,
} from "#core/events/module-event.js";
import type { LocalClientHandlers } from "#core/server/kota-client.js";
import { executeTool, getModuleToolNames, registerTool } from "#core/tools/index.js";
import { registerCustomGroup } from "#core/tools/tool-groups.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { loadForeignModules } from "./foreign-module-loader.js";
import { createModuleContext, type ModuleContextParams } from "./module-context.js";
import { topoSort } from "./module-deps.js";
import { reimportInstalledModule } from "./module-discovery.js";
import { getModuleDependents, type LifecycleState, unloadAllModules, unloadModule } from "./module-lifecycle.js";
import type { ModuleStorage } from "./module-storage.js";
import {
  type ControlRouteRegistration,
  type CreateSessionOptions,
  type HealthCheckResult,
  type KotaModule,
  type ModuleContext,
  type ModuleRuntimeContext,
  type ModuleSession,
  type ModuleSource,
  type ModuleSummary,
  type RouteRegistration,
  resolveModuleAgents,
  resolveModuleChannels,
  resolveModuleSkills,
  resolveModuleWorkflows,
  type ToolDef,
} from "./module-types.js";
import { reimportProjectModule } from "./project-discovery.js";
import { getProviderRegistry } from "./provider-registry.js";

export type { ModuleSource, ModuleSummary } from "./module-types.js";

/**
 * Lifecycle mode the loader operates in.
 *
 * - `"commands"`: register CLI command shape and local-side `KotaClient`
 *   handlers, and populate every statically-resolved module contribution
 *   (workflows, channels, agents, skills, routes, control routes). Skips
 *   `onLoad`, tool registration, foreign modules, and provider activation
 *   so CLI startup stays cheap. The accessors that depend on those skipped
 *   side effects — `getRoutes`, `getContributedControlRoutes`, and
 *   `probeHealthChecks` — throw rather than hand back a silently partial
 *   snapshot whose handlers or probes would call into unregistered
 *   providers.
 * - `"runtime"`: drives every module's lifecycle to completion. Required
 *   for daemon, MCP, and any other long-lived runtime host that serves
 *   provider-backed routes, runs workflows, or hosts channels.
 *
 * Splitting these two modes is deliberate. The 2026-04-28 daemon
 * regression was the result of reading `ModuleLoader` route contributions
 * from a `commands` snapshot whose `onLoad` hooks (and therefore the
 * `registerProvider` calls behind `/api/knowledge`, `/api/memory`,
 * `/api/history`, `/recall`, `/answer`) had never run. The typed accessor
 * now fails loudly at the first call instead of letting a half-built
 * runtime ship.
 */
export type ModuleLoaderMode = "commands" | "runtime";

export type ModuleLoaderOptions = {
  /** Lifecycle mode this loader operates in. Defaults to `"runtime"`. */
  mode?: ModuleLoaderMode;
};

/**
 * Internal: getters whose results depend on side effects from `onLoad`
 * (provider registration, foreign-module wiring) or per-module probes that
 * close over runtime state. Statically-resolved contributions
 * (`getContributedWorkflows`, `getContributedChannels`, `getAgentDef`,
 * `getSkillsPrompt(For)`) populate from module definitions during `load()`
 * and remain readable in commands mode.
 */
const RUNTIME_ONLY_GETTERS = [
  "getRoutes",
  "getContributedControlRoutes",
  "probeHealthChecks",
] as const;
type RuntimeOnlyGetter = (typeof RUNTIME_ONLY_GETTERS)[number];

type ModuleLoadFailure = { message: string; timestamp: string };

/**
 * Per-namespace assignment helper for the local client handler map.
 *
 * `Partial<LocalClientHandlers>[K] = LocalClientHandlers[K]` is sound for any
 * fixed `K`, but TypeScript widens the union when the key is loop-typed and
 * the value comes from an indexed read of the same map, leaving no single
 * concrete `K` to bind the assignment to. Narrowing the helper to a single
 * `K` per call expresses the per-key invariant that holds at runtime.
 */
function assignLocalClientHandler<K extends keyof LocalClientHandlers>(
  target: Partial<LocalClientHandlers>,
  namespace: K,
  impl: LocalClientHandlers[K],
): void {
  target[namespace] = impl;
}

export class ModuleLoader {
  private modules: KotaModule[] = [];
  private moduleStorages = new Map<string, ModuleStorage>();
  private moduleRegistry = new Map<string, KotaModule>();
  private moduleToolCounts = new Map<string, number>();
  private moduleWorkflowDefs = new Map<string, readonly RegisteredWorkflowDefinitionInput[]>();
  private moduleChannelDefs = new Map<string, readonly ChannelDef[]>();
  private moduleSkillDefs = new Map<string, readonly SkillDef[]>();
  private moduleAgentDefs = new Map<string, readonly AgentDef[]>();
  private moduleRoutes = new Map<string, RouteRegistration[]>();
  private moduleCommands = new Map<string, Command[]>();
  private moduleControlRoutes = new Map<string, ControlRouteRegistration[]>();
  private moduleRouteErrors = new Map<string, string>();
  private moduleCommandErrors = new Map<string, string>();
  private moduleControlRouteErrors = new Map<string, string>();
  private registeredConfigKeys = new Map<string, string>();
  private loadFailures = new Map<string, ModuleLoadFailure>();
  private moduleSources = new Map<string, ModuleSource>();
  private skillContentsByName = new Map<string, string>();
  private skillDefsByName = new Map<string, SkillDef>();
  private contributedWorkflows: RegisteredWorkflowDefinitionInput[] = [];
  private contributedChannels: ChannelDef[] = [];
  private bus: EventBus | null = null;
  private localClientHandlers: Partial<LocalClientHandlers> = {};
  private verbose: boolean;
  private config: KotaConfig;
  private cwd: string;
  private readonly mode: ModuleLoaderMode;
  private sessionFactory: ((opts: CreateSessionOptions) => ModuleSession) | null = null;
  private toolCallDepth = 0;
  private static MAX_TOOL_CALL_DEPTH = 10;

  constructor(config: KotaConfig, verbose = false, options?: ModuleLoaderOptions) {
    this.config = config;
    this.verbose = verbose;
    this.cwd = process.cwd();
    this.mode = options?.mode ?? "runtime";
  }

  /** Lifecycle mode this loader was constructed with. */
  getMode(): ModuleLoaderMode {
    return this.mode;
  }

  private get isCommandsMode(): boolean {
    return this.mode === "commands";
  }

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

  setSessionFactory(factory: (opts: CreateSessionOptions) => ModuleSession): void {
    this.sessionFactory = factory;
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  private get lifecycleState(): LifecycleState {
    return {
      modules: this.modules,
      moduleStorages: this.moduleStorages,
      moduleToolCounts: this.moduleToolCounts,
      moduleRegistry: this.moduleRegistry,
      moduleWorkflowDefs: this.moduleWorkflowDefs,
      moduleChannelDefs: this.moduleChannelDefs,
      moduleSkillDefs: this.moduleSkillDefs,
      moduleAgentDefs: this.moduleAgentDefs,
      verbose: this.verbose,
    };
  }

  private createContext(moduleName?: string): ModuleRuntimeContext {
    const params: ModuleContextParams = {
      cwd: this.cwd,
      verbose: this.verbose,
      config: this.config,
      moduleStorages: this.moduleStorages,
      getBus: () => this.bus,
      getRoutes: () => this.getRoutes(),
      getContributedControlRoutes: () => this.getContributedControlRoutes(),
      getContributedWorkflows: () => this.getContributedWorkflows(),
      getContributedChannels: () => this.getContributedChannels(),
      getModuleSummaries: () => this.getModuleSummaries(),
      resolveAgentDef: (name) => this.getAgentDef(name),
      resolveSkillsPrompt: (names, agentName) => this.getSkillsPromptFor(names, agentName),
      sessionFactory: this.sessionFactory,
      probeHealthChecks: () => this.probeHealthChecks(),
      getRegisteredConfigKeys: () => this.getRegisteredConfigKeys(),
      callTool: async (name, input) => {
        if (this.toolCallDepth >= ModuleLoader.MAX_TOOL_CALL_DEPTH) {
          return { content: `Tool call depth limit exceeded (max ${ModuleLoader.MAX_TOOL_CALL_DEPTH})`, is_error: true };
        }
        this.toolCallDepth++;
        try {
          return await executeTool(name, input);
        } finally {
          this.toolCallDepth--;
        }
      },
    };
    return createModuleContext(params, moduleName);
  }

  private collectLocalClientHandlers(
    mod: KotaModule,
    ctx: ModuleRuntimeContext,
  ): void {
    if (!mod.localClient) return;
    const handlers = mod.localClient(ctx) as Partial<LocalClientHandlers>;
    for (const namespace of Object.keys(handlers) as (keyof LocalClientHandlers)[]) {
      const impl = handlers[namespace];
      if (!impl) continue;
      if (this.localClientHandlers[namespace]) {
        throw new Error(
          `Module "${mod.name}" tried to register a local client handler for ` +
            `"${namespace}" but one is already registered. Each KotaClient namespace has a single owner.`,
        );
      }
      assignLocalClientHandler(this.localClientHandlers, namespace, impl);
    }
  }

  /** Snapshot of local-side client handlers registered by loaded modules. */
  getLocalClientHandlers(): Partial<LocalClientHandlers> {
    return { ...this.localClientHandlers };
  }

  async load(mod: KotaModule): Promise<void> {
    if (this.modules.some((m) => m.name === mod.name)) {
      throw new Error(`Duplicate module name: "${mod.name}"`);
    }

    if (mod.dependencies) {
      for (const dep of mod.dependencies) {
        if (!this.modules.some((m) => m.name === dep)) {
          throw new Error(`Module "${mod.name}" requires "${dep}" which is not loaded`);
        }
      }
    }

    if (mod.configSlices) {
      for (const slice of mod.configSlices) {
        const existing = this.registeredConfigKeys.get(slice.key);
        if (existing && existing !== mod.name) {
          throw new Error(
            `Module "${mod.name}" tried to register config key "${slice.key}" already claimed by "${existing}"`,
          );
        }
        registerConfigSlice(slice, mod.name);
        this.registeredConfigKeys.set(slice.key, mod.name);
      }
    }

    if (mod.events && mod.events.length > 0) {
      const registry = getModuleEventRegistry() ?? initModuleEventRegistry();
      for (const def of mod.events) {
        registry.register(mod.name, def);
      }
    }

    const ctx = this.createContext(mod.name);
    const tools: ToolDef[] | undefined = this.isCommandsMode
      ? undefined
      : mod.tools
        ? typeof mod.tools === "function" ? mod.tools(ctx) : mod.tools
        : undefined;

    if (tools && !this.isCommandsMode) {
      for (const def of tools) {
        if (!def.effect) {
          throw new Error(`Module "${mod.name}" tool "${def.tool.name}" missing required metadata: effect`);
        }
        registerTool(def.tool, def.runner, mod.name, { effect: def.effect });
        if (def.group) registerCustomGroup(def.group, [def.tool.name]);
      }
      this.moduleToolCounts.set(mod.name, tools.length);
    }

    const workflows = await resolveModuleWorkflows(mod, ctx);
    if (workflows.length > 0) {
      const source = this.moduleSources.get(mod.name) ?? "project";
      const resolvedWorkflows = workflows.map((def) => {
        const withPath =
          "definitionPath" in def
            ? def
            : { ...def, definitionPath: `modules/${mod.name}` };
        const withRoot =
          withPath.moduleRoot !== undefined
            ? withPath
            : { ...withPath, moduleRoot: this.cwd };
        return {
          ...withRoot,
          contributingModule: withRoot.contributingModule ?? mod.name,
          moduleSource: withRoot.moduleSource ?? source,
        };
      });
      this.moduleWorkflowDefs.set(mod.name, resolvedWorkflows);
      for (const def of resolvedWorkflows) {
        this.contributedWorkflows.push(def);
      }
    }

    const channels = await resolveModuleChannels(mod, ctx);
    if (channels.length > 0) {
      this.moduleChannelDefs.set(mod.name, channels);
      for (const def of channels) {
        this.contributedChannels.push(def);
      }
    }

    this.collectLocalClientHandlers(mod, ctx);

    if (mod.commands) {
      try {
        this.moduleCommands.set(mod.name, mod.commands(ctx));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.moduleCommandErrors.set(mod.name, msg);
        console.error(`[kota] Module "${mod.name}" command registration failed: ${msg}`);
      }
    }

    if (mod.routes) {
      try {
        this.moduleRoutes.set(mod.name, [...mod.routes(ctx)]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.moduleRouteErrors.set(mod.name, msg);
        console.error(`[kota] Module "${mod.name}" route registration failed: ${msg}`);
      }
    }

    if (mod.controlRoutes) {
      try {
        this.moduleControlRoutes.set(mod.name, [...mod.controlRoutes(ctx)]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.moduleControlRouteErrors.set(mod.name, msg);
        console.error(`[kota] Module "${mod.name}" control-route registration failed: ${msg}`);
      }
    }

    if (mod.onLoad && !this.isCommandsMode) await mod.onLoad(ctx);

    const skills = await resolveModuleSkills(mod, ctx);
    if (skills.length > 0) {
      this.moduleSkillDefs.set(mod.name, skills);
      for (const skill of skills) {
        try {
          const content = readFileSync(resolve(this.cwd, skill.promptPath), "utf8").trim();
          if (content) {
            this.skillContentsByName.set(skill.name, `### ${skill.name}\n${content}`);
            this.skillDefsByName.set(skill.name, skill);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Module "${mod.name}" skill "${skill.name}" failed to load: ${msg}`);
        }
      }
    }

    const agents = await resolveModuleAgents(mod, ctx);
    if (agents.length > 0) {
      this.moduleAgentDefs.set(mod.name, agents);
    }

    this.modules.push(mod);
    this.moduleRegistry.set(mod.name, mod);
    if (this.verbose) {
      const tc = this.moduleToolCounts.get(mod.name) ?? 0;
      console.error(`[kota] Module "${mod.name}" loaded (${tc} tools)`);
    }
  }

  async loadAll(projectModules: KotaModule[], installedModules?: KotaModule[]): Promise<void> {
    const projectNames = new Set(projectModules.map((m) => m.name));
    const allModules = [...projectModules, ...(installedModules ?? [])];

    for (const mod of projectModules) this.moduleSources.set(mod.name, "project");
    for (const mod of installedModules ?? []) this.moduleSources.set(mod.name, "installed");

    const sorted = topoSort(allModules);
    for (const mod of sorted) {
      try {
        await this.load(mod);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isProject = projectNames.has(mod.name);
        if (isProject) {
          console.error(`[kota] Module "${mod.name}" failed to load: ${msg}`);
        } else if (this.verbose) {
          console.error(`[kota] Optional module "${mod.name}" skipped: ${msg}`);
        }
        this.loadFailures.set(mod.name, { message: msg, timestamp: new Date().toISOString() });
      }
    }

    if (this.config.foreignModules && this.config.foreignModules.length > 0 && !this.isCommandsMode) {
      const foreign = await loadForeignModules(
        this.config.foreignModules,
        this.cwd,
        this.config.modules,
      );
      for (const mod of foreign) {
        this.moduleSources.set(mod.name, "foreign");
        try {
          await this.load(mod);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Foreign module "${mod.name}" failed to register: ${msg}`);
        }
      }
    }

    this.activateConfiguredProviders();

    const projectFailures = [...this.loadFailures.entries()]
      .filter(([name]) => projectNames.has(name));
    if (projectFailures.length > 0) {
      const details = projectFailures.map(([name, f]) => `  ${name}: ${f.message}`).join("\n");
      throw new Error(
        `${projectFailures.length} project module(s) failed to load:\n${details}`,
      );
    }

    if (this.modules.length > 0 && this.verbose) {
      console.error(`[kota] Modules: ${this.modules.length} loaded, ${this.getToolCount()} tool(s)`);
    }
  }

  getCommands(): Command[] {
    const commands: Command[] = [];
    for (const mod of this.modules) {
      const cached = this.moduleCommands.get(mod.name);
      if (cached) commands.push(...cached);
    }
    return commands;
  }

  getRoutes(): RouteRegistration[] {
    this.assertRuntime("getRoutes");
    const routes: RouteRegistration[] = [];
    for (const mod of this.modules) {
      const cached = this.moduleRoutes.get(mod.name);
      if (cached) routes.push(...cached);
    }
    return routes;
  }

  getContributedControlRoutes(): ControlRouteRegistration[] {
    this.assertRuntime("getContributedControlRoutes");
    const routes: ControlRouteRegistration[] = [];
    for (const mod of this.modules) {
      const cached = this.moduleControlRoutes.get(mod.name);
      if (cached) routes.push(...cached);
    }
    return routes;
  }

  getContributedWorkflows(): RegisteredWorkflowDefinitionInput[] {
    return this.contributedWorkflows;
  }

  getContributedChannels(): ChannelDef[] {
    return this.contributedChannels;
  }

  setBus(bus: EventBus): void {
    this.bus = bus;
  }

  getSkillsPrompt(): string {
    return this.getSkillsPromptFor("all");
  }

  getSkillsPromptFor(skillNames: string[] | "all", agentName?: string): string {
    if (this.skillContentsByName.size === 0) return "";
    const names = skillNames === "all"
      ? [...this.skillContentsByName.keys()]
      : skillNames;
    const entries = names
      .filter((name) => {
        const def = this.skillDefsByName.get(name);
        if (!def) return skillNames !== "all";
        if (!def.roles || def.roles.length === 0) return true;
        return agentName !== undefined && def.roles.includes(agentName);
      })
      .map((name) => this.skillContentsByName.get(name))
      .filter((c): c is string => c !== undefined);
    if (entries.length === 0) return "";
    return `\n\n## Module Capabilities\n${entries.join("\n\n")}`;
  }

  getAgentDef(name: string): AgentDef | undefined {
    for (const agents of this.moduleAgentDefs.values()) {
      const found = agents.find((a) => a.name === name);
      if (found) return found;
    }
    return undefined;
  }

  getRegisteredConfigKeys(): ReadonlySet<string> {
    return new Set(this.registeredConfigKeys.keys());
  }

  getModuleStorage(moduleName: string): ModuleStorage | undefined {
    return this.moduleStorages.get(moduleName);
  }

  async unload(moduleName: string): Promise<boolean> {
    const result = await unloadModule(moduleName, this.lifecycleState);
    if (result) this.cleanupLoaderState(moduleName);
    return result;
  }

  async reload(moduleName: string): Promise<boolean> {
    const source = this.moduleSources.get(moduleName);
    const registryMod = this.moduleRegistry.get(moduleName);
    if (!registryMod) return false;

    const freshMod = source ? await this.reimportModule(moduleName, source) : null;
    const modToLoad = freshMod ?? registryMod;

    if (this.modules.some((m) => m.name === moduleName)) {
      await this.unload(moduleName);
    }

    await this.load(modToLoad);
    if (source) this.moduleSources.set(moduleName, source);

    if (this.verbose) {
      const how = freshMod ? "from disk" : "from registry";
      console.error(`[kota] Module "${moduleName}" reloaded (${how})`);
    }
    return true;
  }

  getDependents(moduleName: string): string[] {
    return getModuleDependents(moduleName, this.modules);
  }

  async unloadAll(): Promise<void> {
    const owners = [...new Set(this.registeredConfigKeys.values())];
    const eventOwners = this.modules.map((m) => m.name);
    await unloadAllModules(this.lifecycleState);
    for (const owner of owners) unregisterConfigSlicesForOwner(owner);
    const registry = getModuleEventRegistry();
    if (registry) {
      for (const owner of eventOwners) registry.unregisterModule(owner);
    }
    this.registeredConfigKeys.clear();
    this.contributedWorkflows.splice(0);
    this.contributedChannels.splice(0);
    this.skillContentsByName.clear();
    this.skillDefsByName.clear();
    this.moduleRoutes.clear();
    this.moduleCommands.clear();
    this.moduleControlRoutes.clear();
    this.moduleRouteErrors.clear();
    this.moduleCommandErrors.clear();
    this.moduleControlRouteErrors.clear();
    this.moduleSources.clear();
    this.loadFailures.clear();
    this.bus = null;
  }

  private cleanupLoaderState(moduleName: string): void {
    for (const [key, owner] of this.registeredConfigKeys) {
      if (owner === moduleName) this.registeredConfigKeys.delete(key);
    }
    unregisterConfigSlicesForOwner(moduleName);
    getModuleEventRegistry()?.unregisterModule(moduleName);
    this.moduleRoutes.delete(moduleName);
    this.moduleCommands.delete(moduleName);
    this.moduleControlRoutes.delete(moduleName);
    this.moduleRouteErrors.delete(moduleName);
    this.moduleCommandErrors.delete(moduleName);
    this.moduleControlRouteErrors.delete(moduleName);

    const wfDefs = this.moduleWorkflowDefs.get(moduleName);
    if (wfDefs) {
      const wfNames = new Set(wfDefs.map((w) => w.name));
      for (let i = this.contributedWorkflows.length - 1; i >= 0; i--) {
        if (wfNames.has(this.contributedWorkflows[i].name)) {
          this.contributedWorkflows.splice(i, 1);
        }
      }
    }

    const chDefs = this.moduleChannelDefs.get(moduleName);
    if (chDefs) {
      const chNames = new Set(chDefs.map((c) => c.name));
      for (let i = this.contributedChannels.length - 1; i >= 0; i--) {
        if (chNames.has(this.contributedChannels[i].name)) {
          this.contributedChannels.splice(i, 1);
        }
      }
    }

    const skillDefs = this.moduleSkillDefs.get(moduleName);
    if (skillDefs) {
      for (const skill of skillDefs) {
        this.skillContentsByName.delete(skill.name);
        this.skillDefsByName.delete(skill.name);
      }
    }
  }

  private async reimportModule(name: string, source: ModuleSource): Promise<KotaModule | null> {
    try {
      if (source === "project") return await reimportProjectModule(name);
      if (source === "installed") return await reimportInstalledModule(name, this.cwd);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Failed to reimport module "${name}": ${msg}`);
      return null;
    }
  }

  private activateConfiguredProviders(): void {
    const providers = this.config.providers;
    if (!providers) return;
    const reg = getProviderRegistry();
    if (!reg) return;

    for (const [type, name] of Object.entries(providers)) {
      if (!reg.setActiveById(type, name)) {
        const available = reg.introspect(type).names.join(", ") || "(none)";
        console.error(
          `[kota] Provider "${name}" for "${type}" not found. Available: ${available}`,
        );
      } else if (this.verbose) {
        console.error(`[kota] Provider for "${type}" set to "${name}"`);
      }
    }
  }

  getLoadedModules(): string[] {
    return this.modules.map((e) => e.name);
  }

  getModuleCount(): number {
    return this.modules.length;
  }

  getToolCount(): number {
    if (this.isCommandsMode) return 0;
    let total = 0;
    for (const count of this.moduleToolCounts.values()) total += count;
    return total;
  }

  getModuleSummaries(): ModuleSummary[] {
    const loaded = this.modules.map((mod) => {
      const commandNames: string[] = [];
      const cachedCommands = this.moduleCommands.get(mod.name);
      if (cachedCommands) {
        for (const cmd of cachedCommands) commandNames.push(cmd.name());
      }
      const commandError = this.moduleCommandErrors.get(mod.name);
      const routeSummaries: string[] = [];
      const cachedRoutes = this.moduleRoutes.get(mod.name);
      if (cachedRoutes) {
        for (const r of cachedRoutes) routeSummaries.push(`${r.method} ${r.path}`);
      }
      const routeError = this.moduleRouteErrors.get(mod.name);
      return {
        name: mod.name,
        source: this.moduleSources.get(mod.name) ?? "project",
        version: mod.version,
        description: mod.description,
        dependencies: mod.dependencies ?? [],
        toolNames: getModuleToolNames(mod.name),
        workflowNames: (this.moduleWorkflowDefs.get(mod.name) ?? []).map((w) => w.name),
        channelNames: (this.moduleChannelDefs.get(mod.name) ?? []).map((c) => c.name),
        skillNames: (this.moduleSkillDefs.get(mod.name) ?? []).map((s) => s.name),
        agentNames: (this.moduleAgentDefs.get(mod.name) ?? []).map((a) => a.name),
        agents: [...(this.moduleAgentDefs.get(mod.name) ?? [])],
        skills: [...(this.moduleSkillDefs.get(mod.name) ?? [])],
        commandNames,
        routeSummaries,
        ...(commandError ? { commandError } : {}),
        ...(routeError ? { routeError } : {}),
        health: mod.getHealth?.(),
      };
    });
    const failed: ModuleSummary[] = [];
    for (const [name, failure] of this.loadFailures) {
      failed.push({
        name,
        source: this.moduleSources.get(name) ?? "project",
        dependencies: [],
        toolNames: [],
        workflowNames: [],
        channelNames: [],
        skillNames: [],
        agentNames: [],
        agents: [],
        skills: [],
        commandNames: [],
        routeSummaries: [],
        loadError: failure.message.slice(0, 500),
      });
    }
    return [...loaded, ...failed];
  }

  async probeHealthChecks(): Promise<Record<string, HealthCheckResult>> {
    this.assertRuntime("probeHealthChecks");
    const results: Record<string, HealthCheckResult> = {};
    for (const mod of this.modules) {
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
