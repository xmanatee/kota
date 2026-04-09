import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { ChannelDef } from "./channel.js";
import type { KotaConfig } from "./config.js";
import type { EventBus } from "./event-bus.js";
import { createModuleContext, type ModuleContextParams } from "./module-context.js";
import { topoSort } from "./module-deps.js";
import { getModuleDependents, type LifecycleState, reloadModule, unloadAllModules, unloadModule } from "./module-lifecycle.js";
import type { ModuleStorage } from "./module-storage.js";
import {
  resolveModuleAgents,
  resolveModuleChannels,
  resolveModuleSkills,
  resolveModuleWorkflows,
  type CreateSessionOptions,
  type ModuleContext,
  type ModuleSession,
  type ModuleSummary,
  type KotaModule,
  type RouteRegistration,
  type ToolDef,
} from "./module-types.js";
import { getProviderRegistry } from "./modules/providers/index.js";
import { loadForeignModules } from "./foreign-module-loader.js";
import { registerCustomGroup } from "./tool-groups.js";
import { executeTool, getModuleToolNames, registerTool } from "./tools/index.js";
import type { RegisteredWorkflowDefinitionInput } from "./workflow/types.js";
import type { AgentDef, SkillDef } from "./agent-types.js";

export type { ModuleSummary } from "./module-types.js";

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
  private loadFailures = new Map<string, ModuleLoadFailure>();
  private skillContents: string[] = [];
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
      sessionFactory: this.sessionFactory,
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

    const ctx = this.createContext(mod.name);
    const tools: ToolDef[] | undefined = mod.tools
      ? typeof mod.tools === "function" ? mod.tools(ctx) : mod.tools
      : undefined;

    if (tools && !this.commandsOnly) {
      for (const def of tools) {
        if (!def.risk) {
          console.error(`[kota] Module "${mod.name}" tool "${def.tool.name}" has no risk annotation — defaulting to unclassified (moderate)`);
        }
        registerTool(def.tool, def.runner, mod.name, { risk: def.risk, kind: def.kind });
        if (def.group) registerCustomGroup(def.group, [def.tool.name]);
      }
      this.moduleToolCounts.set(mod.name, tools.length);
    }

    const workflows = await resolveModuleWorkflows(mod, ctx);
    if (workflows.length > 0) {
      const resolvedWorkflows = workflows.map((def) =>
        "definitionPath" in def
          ? def
          : {
              ...def,
              definitionPath: `modules/${mod.name}`,
            },
      );
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
            if (content) this.skillContents.push(`### ${skill.name}\n${content}`);
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

  async loadAll(modules: KotaModule[]): Promise<void> {
    const sorted = topoSort(modules);
    for (const ext of sorted) {
      try {
        await this.load(ext);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Module "${ext.name}" failed to load: ${msg}`);
        this.loadFailures.set(ext.name, { message: msg, timestamp: new Date().toISOString() });
      }
    }
    if (this.config.foreignModules && this.config.foreignModules.length > 0 && !this.commandsOnly) {
      const foreign = await loadForeignModules(
        this.config.foreignModules,
        this.cwd,
        this.config.modules,
      );
      for (const ext of foreign) {
        try {
          await this.load(ext);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Foreign module "${ext.name}" failed to register: ${msg}`);
        }
      }
    }
    this.activateConfiguredProviders();
    if (this.modules.length > 0 && this.verbose) {
      console.error(`[kota] Modules: ${this.modules.length} loaded, ${this.getToolCount()} tool(s)`);
    }
  }

  getCommands(): Command[] {
    const commands: Command[] = [];
    for (const ext of this.modules) {
      if (ext.commands) {
        try {
          commands.push(...ext.commands(this.createContext(ext.name)));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Module "${ext.name}" command registration failed: ${msg}`);
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
      for (const ext of this.modules) {
        if (ext.routes) {
          try {
            routes.push(...ext.routes(this.createContext(ext.name)));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[kota] Module "${ext.name}" route registration failed: ${msg}`);
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
    if (this.skillContents.length === 0) return "";
    return `\n\n## Module Capabilities\n${this.skillContents.join("\n\n")}`;
  }

  getModuleStorage(moduleName: string): ModuleStorage | undefined {
    return this.moduleStorages.get(moduleName);
  }

  async unload(moduleName: string): Promise<boolean> {
    return unloadModule(moduleName, this.lifecycleState);
  }

  async reload(moduleName: string): Promise<boolean> {
    return reloadModule(
      moduleName,
      this.lifecycleState,
      (ext) => this.load(ext),
    );
  }

  getDependents(moduleName: string): string[] {
    return getModuleDependents(moduleName, this.modules);
  }

  async unloadAll(): Promise<void> {
    await unloadAllModules(this.lifecycleState);
    this.bus = null;
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
    const loaded = this.modules.map((ext) => {
      const commandNames: string[] = [];
      let commandError: string | undefined;
      if (ext.commands) {
        try {
          const cmds = ext.commands(this.createContext(ext.name));
          for (const cmd of cmds) commandNames.push(cmd.name());
        } catch (err) {
          commandError = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Module "${ext.name}" command summary failed: ${commandError}`);
        }
      }
      const routeSummaries: string[] = [];
      let routeError: string | undefined;
      if (ext.routes) {
        try {
          const routes = ext.routes(this.createContext(ext.name));
          for (const r of routes) routeSummaries.push(`${r.method} ${r.path}`);
        } catch (err) {
          routeError = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Module "${ext.name}" route summary failed: ${routeError}`);
        }
      }
      return {
        name: ext.name,
        version: ext.version,
        description: ext.description,
        dependencies: ext.dependencies ?? [],
        toolNames: getModuleToolNames(ext.name),
        workflowNames: (this.moduleWorkflowDefs.get(ext.name) ?? []).map((w) => w.name),
        channelNames: (this.moduleChannelDefs.get(ext.name) ?? []).map((c) => c.name),
        skillNames: (this.moduleSkillDefs.get(ext.name) ?? []).map((s) => s.name),
        agentNames: (this.moduleAgentDefs.get(ext.name) ?? []).map((a) => a.name),
        agents: [...(this.moduleAgentDefs.get(ext.name) ?? [])],
        skills: [...(this.moduleSkillDefs.get(ext.name) ?? [])],
        commandNames,
        routeSummaries,
        ...(commandError ? { commandError } : {}),
        ...(routeError ? { routeError } : {}),
        health: ext.getHealth?.(),
      };
    });
    const failed: ModuleSummary[] = [];
    for (const [name, failure] of this.loadFailures) {
      failed.push({
        name,
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
}
