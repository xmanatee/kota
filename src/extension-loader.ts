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
import type { CreateSessionOptions, ExtensionContext, ExtensionSession, ExtensionSummary, KotaExtension, RouteRegistration, ToolDef } from "./extension-types.js";
import { loadForeignExtensions } from "./foreign-extension-loader.js";
import { getProviderRegistry } from "./providers.js";
import { registerCustomGroup } from "./tool-groups.js";
import { executeTool, getExtensionToolNames, registerTool } from "./tools/index.js";
import type { RegisteredWorkflowDefinitionInput } from "./workflow/types.js";

export type { ExtensionSummary } from "./extension-types.js";

export type ExtensionLoaderOptions = {
  /** Skip tool registration — only load extensions for command/route discovery. */
  commandsOnly?: boolean;
};

export class ExtensionLoader {
  private extensions: KotaExtension[] = [];
  private extensionStorages = new Map<string, ExtensionStorage>();
  private extensionRegistry = new Map<string, KotaExtension>();
  private extensionToolCounts = new Map<string, number>();
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
        registerTool(def.tool, def.runner, ext.name);
        if (def.group) registerCustomGroup(def.group, [def.tool.name]);
      }
      this.extensionToolCounts.set(ext.name, tools.length);
    }

    if (ext.workflows && !this.commandsOnly) {
      for (const def of ext.workflows) {
        this.contributedWorkflows.push({ ...def, definitionPath: `extensions/${ext.name}` });
      }
    }

    if (ext.channels && !this.commandsOnly) {
      for (const def of ext.channels) {
        this.contributedChannels.push(def);
      }
    }

    if (ext.onLoad && !this.commandsOnly) await ext.onLoad(ctx);

    if (ext.skills && !this.commandsOnly) {
      for (const skill of ext.skills) {
        try {
          const content = readFileSync(resolve(this.cwd, skill.promptPath), "utf8").trim();
          if (content) this.skillContents.push(`### ${skill.name}\n${content}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Extension "${ext.name}" skill "${skill.name}" failed to load: ${msg}`);
        }
      }
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
    return this.extensions.map((ext) => {
      const commandNames: string[] = [];
      if (ext.commands) {
        try {
          const cmds = ext.commands(this.createContext(ext.name));
          for (const cmd of cmds) commandNames.push(cmd.name());
        } catch {
          // ignore errors from command factory
        }
      }
      const routeSummaries: string[] = [];
      if (ext.routes) {
        try {
          const routes = ext.routes(this.createContext(ext.name));
          for (const r of routes) routeSummaries.push(`${r.method} ${r.path}`);
        } catch {
          // ignore errors from route factory
        }
      }
      return {
        name: ext.name,
        version: ext.version,
        description: ext.description,
        dependencies: ext.dependencies ?? [],
        toolNames: getExtensionToolNames(ext.name),
        workflowNames: (ext.workflows ?? []).map((w) => w.name),
        channelNames: (ext.channels ?? []).map((c) => c.name),
        skillNames: (ext.skills ?? []).map((s) => s.name),
        agentNames: (ext.agents ?? []).map((a) => a.name),
        agents: ext.agents ?? [],
        skills: ext.skills ?? [],
        commandNames,
        routeSummaries,
      };
    });
  }
}
