import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { ChannelDef } from "./channel.js";
import type { KotaConfig } from "./config.js";
import type { EventBus } from "./event-bus.js";
import { createExtensionContext, type ExtensionContextParams } from "./extension-context.js";
import { topoSort } from "./extension-deps.js";
import { getExtensionDependents, type LifecycleState, reloadExtension, unloadAllExtensions, unloadExtension } from "./extension-lifecycle.js";
import type { ExtensionStorage } from "./extension-storage.js";
import {
  resolveExtensionAgents,
  resolveExtensionChannels,
  resolveExtensionSkills,
  resolveExtensionWorkflows,
  type CreateSessionOptions,
  type ExtensionContext,
  type ExtensionSession,
  type ExtensionSummary,
  type KotaExtension,
  type RouteRegistration,
  type ToolDef,
} from "./extension-types.js";
import { getProviderRegistry } from "./extensions/providers/index.js";
import { loadForeignExtensions } from "./foreign-extension-loader.js";
import { registerCustomGroup } from "./tool-groups.js";
import { executeTool, getExtensionToolNames, registerTool } from "./tools/index.js";
import type { RegisteredWorkflowDefinitionInput } from "./workflow/types.js";
import type { AgentDef, SkillDef } from "./agent-types.js";

export type { ExtensionSummary } from "./extension-types.js";

export type ExtensionLoaderOptions = {
  /** Skip tool registration — only load extensions for command/route discovery. */
  commandsOnly?: boolean;
};

type ExtensionLoadFailure = { message: string; timestamp: string };

export class ExtensionLoader {
  private extensions: KotaExtension[] = [];
  private extensionStorages = new Map<string, ExtensionStorage>();
  private extensionRegistry = new Map<string, KotaExtension>();
  private extensionToolCounts = new Map<string, number>();
  private extensionWorkflowDefs = new Map<string, readonly RegisteredWorkflowDefinitionInput[]>();
  private extensionChannelDefs = new Map<string, readonly ChannelDef[]>();
  private extensionSkillDefs = new Map<string, readonly SkillDef[]>();
  private extensionAgentDefs = new Map<string, readonly AgentDef[]>();
  private loadFailures = new Map<string, ExtensionLoadFailure>();
  private skillContents: string[] = [];
  private contributedWorkflows: RegisteredWorkflowDefinitionInput[] = [];
  private contributedChannels: ChannelDef[] = [];
  private bus: EventBus | null = null;
  private verbose: boolean;
  private config: KotaConfig;
  private cwd: string;
  private commandsOnly: boolean;
  private collectingRoutes = false;
  private sessionFactory: ((opts: CreateSessionOptions) => ExtensionSession) | null = null;
  private toolCallDepth = 0;
  private static MAX_TOOL_CALL_DEPTH = 10;

  constructor(config: KotaConfig, verbose = false, options?: ExtensionLoaderOptions) {
    this.config = config;
    this.verbose = verbose;
    this.cwd = process.cwd();
    this.commandsOnly = options?.commandsOnly ?? false;
  }

  setSessionFactory(factory: (opts: CreateSessionOptions) => ExtensionSession): void {
    this.sessionFactory = factory;
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  private get lifecycleState(): LifecycleState {
    return {
      extensions: this.extensions,
      extensionStorages: this.extensionStorages,
      extensionToolCounts: this.extensionToolCounts,
      extensionRegistry: this.extensionRegistry,
      extensionWorkflowDefs: this.extensionWorkflowDefs,
      extensionChannelDefs: this.extensionChannelDefs,
      extensionSkillDefs: this.extensionSkillDefs,
      extensionAgentDefs: this.extensionAgentDefs,
      verbose: this.verbose,
    };
  }

  private createContext(extensionName?: string): ExtensionContext {
    const params: ExtensionContextParams = {
      cwd: this.cwd,
      verbose: this.verbose,
      config: this.config,
      extensionStorages: this.extensionStorages,
      getBus: () => this.bus,
      getRoutes: () => this.getRoutes(),
      getContributedWorkflows: () => this.getContributedWorkflows(),
      getContributedChannels: () => this.getContributedChannels(),
      getExtensionSummaries: () => this.getExtensionSummaries(),
      sessionFactory: this.sessionFactory,
      callTool: async (name, input) => {
        if (this.toolCallDepth >= ExtensionLoader.MAX_TOOL_CALL_DEPTH) {
          return { content: `Tool call depth limit exceeded (max ${ExtensionLoader.MAX_TOOL_CALL_DEPTH})`, is_error: true };
        }
        this.toolCallDepth++;
        try {
          return await executeTool(name, input);
        } finally {
          this.toolCallDepth--;
        }
      },
    };
    return createExtensionContext(params, extensionName);
  }

  async load(ext: KotaExtension): Promise<void> {
    if (this.extensions.some((e) => e.name === ext.name)) {
      throw new Error(`Duplicate extension name: "${ext.name}"`);
    }

    if (ext.dependencies) {
      for (const dep of ext.dependencies) {
        if (!this.extensions.some((e) => e.name === dep)) {
          throw new Error(`Extension "${ext.name}" requires "${dep}" which is not loaded`);
        }
      }
    }

    const ctx = this.createContext(ext.name);
    const tools: ToolDef[] | undefined = ext.tools
      ? typeof ext.tools === "function" ? ext.tools(ctx) : ext.tools
      : undefined;

    if (tools && !this.commandsOnly) {
      for (const def of tools) {
        if (!def.risk) {
          console.error(`[kota] Extension "${ext.name}" tool "${def.tool.name}" has no risk annotation — defaulting to unclassified (moderate)`);
        }
        registerTool(def.tool, def.runner, ext.name, { risk: def.risk, kind: def.kind });
        if (def.group) registerCustomGroup(def.group, [def.tool.name]);
      }
      this.extensionToolCounts.set(ext.name, tools.length);
    }

    const workflows = await resolveExtensionWorkflows(ext, ctx);
    if (workflows.length > 0) {
      const resolvedWorkflows = workflows.map((def) =>
        "definitionPath" in def
          ? def
          : {
              ...def,
              definitionPath: `extensions/${ext.name}`,
            },
      );
      this.extensionWorkflowDefs.set(ext.name, resolvedWorkflows);
      for (const def of resolvedWorkflows) {
        this.contributedWorkflows.push(def);
      }
    }

    const channels = await resolveExtensionChannels(ext, ctx);
    if (channels.length > 0) {
      this.extensionChannelDefs.set(ext.name, channels);
      for (const def of channels) {
        this.contributedChannels.push(def);
      }
    }

    if (ext.onLoad && !this.commandsOnly) await ext.onLoad(ctx);

    const skills = await resolveExtensionSkills(ext, ctx);
    if (skills.length > 0) {
      this.extensionSkillDefs.set(ext.name, skills);
      if (!this.commandsOnly) {
        for (const skill of skills) {
          try {
            const content = readFileSync(resolve(this.cwd, skill.promptPath), "utf8").trim();
            if (content) this.skillContents.push(`### ${skill.name}\n${content}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[kota] Extension "${ext.name}" skill "${skill.name}" failed to load: ${msg}`);
          }
        }
      }
    }

    const agents = await resolveExtensionAgents(ext, ctx);
    if (agents.length > 0) {
      this.extensionAgentDefs.set(ext.name, agents);
    }

    this.extensions.push(ext);
    this.extensionRegistry.set(ext.name, ext);
    if (this.verbose) {
      const tc = this.extensionToolCounts.get(ext.name) ?? 0;
      console.error(`[kota] Extension "${ext.name}" loaded (${tc} tools)`);
    }
  }

  async loadAll(extensions: KotaExtension[]): Promise<void> {
    const sorted = topoSort(extensions);
    for (const ext of sorted) {
      try {
        await this.load(ext);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Extension "${ext.name}" failed to load: ${msg}`);
        this.loadFailures.set(ext.name, { message: msg, timestamp: new Date().toISOString() });
      }
    }
    if (this.config.foreignExtensions && this.config.foreignExtensions.length > 0 && !this.commandsOnly) {
      const foreign = await loadForeignExtensions(
        this.config.foreignExtensions,
        this.cwd,
        this.config.extensions,
      );
      for (const ext of foreign) {
        try {
          await this.load(ext);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Foreign extension "${ext.name}" failed to register: ${msg}`);
        }
      }
    }
    this.activateConfiguredProviders();
    if (this.extensions.length > 0 && this.verbose) {
      console.error(`[kota] Extensions: ${this.extensions.length} loaded, ${this.getToolCount()} tool(s)`);
    }
  }

  getCommands(): Command[] {
    const commands: Command[] = [];
    for (const ext of this.extensions) {
      if (ext.commands) {
        try {
          commands.push(...ext.commands(this.createContext(ext.name)));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Extension "${ext.name}" command registration failed: ${msg}`);
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
      for (const ext of this.extensions) {
        if (ext.routes) {
          try {
            routes.push(...ext.routes(this.createContext(ext.name)));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[kota] Extension "${ext.name}" route registration failed: ${msg}`);
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
    return `\n\n## Extension Capabilities\n${this.skillContents.join("\n\n")}`;
  }

  getExtensionStorage(extensionName: string): ExtensionStorage | undefined {
    return this.extensionStorages.get(extensionName);
  }

  async unload(extensionName: string): Promise<boolean> {
    return unloadExtension(extensionName, this.lifecycleState);
  }

  async reload(extensionName: string): Promise<boolean> {
    return reloadExtension(
      extensionName,
      this.lifecycleState,
      (ext) => this.load(ext),
    );
  }

  getDependents(extensionName: string): string[] {
    return getExtensionDependents(extensionName, this.extensions);
  }

  async unloadAll(): Promise<void> {
    await unloadAllExtensions(this.lifecycleState);
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

  getLoadedExtensions(): string[] {
    return this.extensions.map((e) => e.name);
  }

  getExtensionCount(): number {
    return this.extensions.length;
  }

  getToolCount(): number {
    if (this.commandsOnly) return 0;
    let total = 0;
    for (const count of this.extensionToolCounts.values()) total += count;
    return total;
  }

  getExtensionSummaries(): ExtensionSummary[] {
    const loaded = this.extensions.map((ext) => {
      const commandNames: string[] = [];
      let commandError: string | undefined;
      if (ext.commands) {
        try {
          const cmds = ext.commands(this.createContext(ext.name));
          for (const cmd of cmds) commandNames.push(cmd.name());
        } catch (err) {
          commandError = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Extension "${ext.name}" command summary failed: ${commandError}`);
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
          console.error(`[kota] Extension "${ext.name}" route summary failed: ${routeError}`);
        }
      }
      return {
        name: ext.name,
        version: ext.version,
        description: ext.description,
        dependencies: ext.dependencies ?? [],
        toolNames: getExtensionToolNames(ext.name),
        workflowNames: (this.extensionWorkflowDefs.get(ext.name) ?? []).map((w) => w.name),
        channelNames: (this.extensionChannelDefs.get(ext.name) ?? []).map((c) => c.name),
        skillNames: (this.extensionSkillDefs.get(ext.name) ?? []).map((s) => s.name),
        agentNames: (this.extensionAgentDefs.get(ext.name) ?? []).map((a) => a.name),
        agents: [...(this.extensionAgentDefs.get(ext.name) ?? [])],
        skills: [...(this.extensionSkillDefs.get(ext.name) ?? [])],
        commandNames,
        routeSummaries,
        ...(commandError ? { commandError } : {}),
        ...(routeError ? { routeError } : {}),
        health: ext.getHealth?.(),
      };
    });
    const failed: ExtensionSummary[] = [];
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
