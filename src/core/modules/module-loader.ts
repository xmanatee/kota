import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { AgentDef, SkillDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { EventBus } from "#core/events/event-bus.js";
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
  type CreateSessionOptions,
  type HealthCheckResult,
  type KotaModule,
  type ModuleContext,
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

export type ModuleLoaderOptions = {
  /** Skip tool registration — only load modules for command/route discovery. */
  commandsOnly?: boolean;
};

type ModuleLoadFailure = { message: string; timestamp: string };

export class ModuleLoader {
  private modules: KotaModule[] = [];
  private moduleStorages = new Map<string, ModuleStorage>();
  private moduleRegistry = new Map<string, KotaModule>();
  private moduleToolCounts = new Map<string, number>();
  private moduleWorkflowDefs = new Map<string, readonly RegisteredWorkflowDefinitionInput[]>();
  private moduleChannelDefs = new Map<string, readonly ChannelDef[]>();
  private moduleSkillDefs = new Map<string, readonly SkillDef[]>();
  private moduleAgentDefs = new Map<string, readonly AgentDef[]>();
  private registeredConfigKeys = new Map<string, string>();
  private loadFailures = new Map<string, ModuleLoadFailure>();
  private moduleSources = new Map<string, ModuleSource>();
  private skillContentsByName = new Map<string, string>();
  private skillDefsByName = new Map<string, SkillDef>();
  private contributedWorkflows: RegisteredWorkflowDefinitionInput[] = [];
  private contributedChannels: ChannelDef[] = [];
  private bus: EventBus | null = null;
  private verbose: boolean;
  private config: KotaConfig;
  private cwd: string;
  private commandsOnly: boolean;
  private collectingRoutes = false;
  private sessionFactory: ((opts: CreateSessionOptions) => ModuleSession) | null = null;
  private toolCallDepth = 0;
  private static MAX_TOOL_CALL_DEPTH = 10;

  constructor(config: KotaConfig, verbose = false, options?: ModuleLoaderOptions) {
    this.config = config;
    this.verbose = verbose;
    this.cwd = process.cwd();
    this.commandsOnly = options?.commandsOnly ?? false;
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

  private createContext(moduleName?: string): ModuleContext {
    const params: ModuleContextParams = {
      cwd: this.cwd,
      verbose: this.verbose,
      config: this.config,
      moduleStorages: this.moduleStorages,
      getBus: () => this.bus,
      getRoutes: () => this.getRoutes(),
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

    if (mod.configKeys) {
      for (const ck of mod.configKeys) {
        const existing = this.registeredConfigKeys.get(ck.key);
        if (existing) {
          throw new Error(
            `Module "${mod.name}" tried to register config key "${ck.key}" already claimed by "${existing}"`,
          );
        }
        this.registeredConfigKeys.set(ck.key, mod.name);
      }
    }

    const ctx = this.createContext(mod.name);
    const tools: ToolDef[] | undefined = this.commandsOnly
      ? undefined
      : mod.tools
        ? typeof mod.tools === "function" ? mod.tools(ctx) : mod.tools
        : undefined;

    if (tools && !this.commandsOnly) {
      for (const def of tools) {
        if (!def.risk || !def.kind) {
          const missing = [!def.risk && "risk", !def.kind && "kind"].filter(Boolean).join(", ");
          throw new Error(`Module "${mod.name}" tool "${def.tool.name}" missing required metadata: ${missing}`);
        }
        registerTool(def.tool, def.runner, mod.name, { risk: def.risk, kind: def.kind });
        if (def.group) registerCustomGroup(def.group, [def.tool.name]);
      }
      this.moduleToolCounts.set(mod.name, tools.length);
    }

    const workflows = await resolveModuleWorkflows(mod, ctx);
    if (workflows.length > 0) {
      const resolvedWorkflows = workflows.map((def) => {
        const withPath =
          "definitionPath" in def
            ? def
            : { ...def, definitionPath: `modules/${mod.name}` };
        return withPath.moduleRoot !== undefined
          ? withPath
          : { ...withPath, moduleRoot: this.cwd };
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

    if (mod.onLoad && !this.commandsOnly) await mod.onLoad(ctx);

    const skills = await resolveModuleSkills(mod, ctx);
    if (skills.length > 0) {
      this.moduleSkillDefs.set(mod.name, skills);
      if (!this.commandsOnly) {
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

    if (this.config.foreignModules && this.config.foreignModules.length > 0 && !this.commandsOnly) {
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
      if (mod.commands) {
        try {
          commands.push(...mod.commands(this.createContext(mod.name)));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Module "${mod.name}" command registration failed: ${msg}`);
        }
      }
    }
    return commands;
  }

  getRoutes(): RouteRegistration[] {
    if (this.collectingRoutes) return [];
    this.collectingRoutes = true;
    try {
      const routes: RouteRegistration[] = [];
      for (const mod of this.modules) {
        if (mod.routes) {
          try {
            routes.push(...mod.routes(this.createContext(mod.name)));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[kota] Module "${mod.name}" route registration failed: ${msg}`);
          }
        }
      }
      return routes;
    } finally {
      this.collectingRoutes = false;
    }
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
    await unloadAllModules(this.lifecycleState);
    this.registeredConfigKeys.clear();
    this.contributedWorkflows.splice(0);
    this.contributedChannels.splice(0);
    this.skillContentsByName.clear();
    this.skillDefsByName.clear();
    this.moduleSources.clear();
    this.loadFailures.clear();
    this.bus = null;
  }

  private cleanupLoaderState(moduleName: string): void {
    for (const [key, owner] of this.registeredConfigKeys) {
      if (owner === moduleName) this.registeredConfigKeys.delete(key);
    }

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
      if (!reg.setActive(type, name)) {
        console.error(
          `[kota] Provider "${name}" for "${type}" not found. Available: ${reg.list(type).join(", ") || "(none)"}`,
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
    if (this.commandsOnly) return 0;
    let total = 0;
    for (const count of this.moduleToolCounts.values()) total += count;
    return total;
  }

  getModuleSummaries(): ModuleSummary[] {
    const loaded = this.modules.map((mod) => {
      const commandNames: string[] = [];
      let commandError: string | undefined;
      if (mod.commands) {
        try {
          const cmds = mod.commands(this.createContext(mod.name));
          for (const cmd of cmds) commandNames.push(cmd.name());
        } catch (err) {
          commandError = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Module "${mod.name}" command summary failed: ${commandError}`);
        }
      }
      const routeSummaries: string[] = [];
      let routeError: string | undefined;
      if (mod.routes) {
        try {
          const routes = mod.routes(this.createContext(mod.name));
          for (const r of routes) routeSummaries.push(`${r.method} ${r.path}`);
        } catch (err) {
          routeError = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Module "${mod.name}" route summary failed: ${routeError}`);
        }
      }
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
