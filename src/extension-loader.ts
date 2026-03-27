import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { KotaConfig } from "./config.js";
import type { EventBus } from "./event-bus.js";
import { createExtensionContext, type ExtensionContextParams } from "./extension-context.js";
import { topoSort } from "./extension-deps.js";
import { getExtensionDependents, type LifecycleState, reloadExtension, unloadAllModules, unloadExtension } from "./extension-lifecycle.js";
import type { ExtensionStorage } from "./extension-storage.js";
import type { CreateSessionOptions, ExtensionContext, ExtensionSession, KotaExtension, RouteRegistration, ToolDef } from "./extension-types.js";
import { getProviderRegistry } from "./providers.js";
import { registerCustomGroup } from "./tool-groups.js";
import { executeTool, registerTool } from "./tools/index.js";
import type { RegisteredWorkflowDefinitionInput } from "./workflow/types.js";

export type ExtensionLoaderOptions = {
  /** Skip tool registration — only load modules for command/route discovery. */
  commandsOnly?: boolean;
};

export class ExtensionLoader {
  private extensions: KotaExtension[] = [];
  private extensionStorages = new Map<string, ExtensionStorage>();
  private extensionRegistry = new Map<string, KotaExtension>();
  private extensionToolCounts = new Map<string, number>();
  private skillContents: string[] = [];
  private contributedWorkflows: RegisteredWorkflowDefinitionInput[] = [];
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

  async load(mod: KotaExtension): Promise<void> {
    if (this.extensions.some((m) => m.name === mod.name)) {
      throw new Error(`Duplicate module name: "${mod.name}"`);
    }

    if (mod.dependencies) {
      for (const dep of mod.dependencies) {
        if (!this.extensions.some((m) => m.name === dep)) {
          throw new Error(`Extension "${mod.name}" requires "${dep}" which is not loaded`);
        }
      }
    }

    const ctx = this.createContext(mod.name);
    const tools: ToolDef[] | undefined = mod.tools
      ? typeof mod.tools === "function" ? mod.tools(ctx) : mod.tools
      : undefined;

    if (tools && !this.commandsOnly) {
      for (const def of tools) {
        registerTool(def.tool, def.runner, mod.name);
        if (def.group) registerCustomGroup(def.group, [def.tool.name]);
      }
      this.extensionToolCounts.set(mod.name, tools.length);
    }

    if (mod.workflows && !this.commandsOnly) {
      for (const def of mod.workflows) {
        this.contributedWorkflows.push({ ...def, definitionPath: `extensions/${mod.name}` });
      }
    }

    if (mod.onLoad && !this.commandsOnly) await mod.onLoad(ctx);

    if (mod.skills && !this.commandsOnly) {
      for (const skill of mod.skills) {
        try {
          const content = readFileSync(resolve(this.cwd, skill.promptPath), "utf8").trim();
          if (content) this.skillContents.push(`### ${skill.name}\n${content}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Extension "${mod.name}" skill "${skill.name}" failed to load: ${msg}`);
        }
      }
    }

    this.extensions.push(mod);
    this.extensionRegistry.set(mod.name, mod);
    if (this.verbose) {
      const tc = this.extensionToolCounts.get(mod.name) ?? 0;
      console.error(`[kota] Extension "${mod.name}" loaded (${tc} tools)`);
    }
  }

  async loadAll(modules: KotaExtension[]): Promise<void> {
    const sorted = topoSort(modules);
    for (const mod of sorted) {
      try {
        await this.load(mod);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Extension "${mod.name}" failed to load: ${msg}`);
      }
    }
    this.activateConfiguredProviders();
    if (this.extensions.length > 0 && this.verbose) {
      console.error(`[kota] Extensions: ${this.extensions.length} loaded, ${this.getToolCount()} tool(s)`);
    }
  }

  getCommands(): Command[] {
    const commands: Command[] = [];
    for (const mod of this.extensions) {
      if (mod.commands) {
        try {
          commands.push(...mod.commands(this.createContext(mod.name)));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[kota] Extension "${mod.name}" command registration failed: ${msg}`);
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
      for (const mod of this.extensions) {
        if (mod.routes) {
          try {
            routes.push(...mod.routes(this.createContext(mod.name)));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[kota] Extension "${mod.name}" route registration failed: ${msg}`);
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
      (mod) => this.load(mod),
    );
  }

  getDependents(extensionName: string): string[] {
    return getExtensionDependents(extensionName, this.extensions);
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

  getLoadedExtensions(): string[] {
    return this.extensions.map((m) => m.name);
  }

  getModuleCount(): number {
    return this.extensions.length;
  }

  getToolCount(): number {
    if (this.commandsOnly) return 0;
    let total = 0;
    for (const count of this.extensionToolCounts.values()) total += count;
    return total;
  }
}
